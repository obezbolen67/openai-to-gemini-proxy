import express from "express";
import fs from "fs";
import cors from "cors";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { modelsList, modelMap } from "./src/models.js";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import axios from "axios";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

const app = express();
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb" }));
app.use(cors()); 

let GEMINI_API_KEY;
async function getData(url, type) {
    const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

    let data;

    if (url.startsWith("data:")) {
        return url.split("base64,")[1];
    }

    if (type === "image" || type === "audio") {
        data = (await axios.get(url, { responseType: "arraybuffer" })).data;

        return Buffer.from(data).toString("base64");
    } else if (type === "video") {
        const uri = await new Promise(async (res) => {
            axios({ method: "get", url: url, responseType: "stream" }).then(
                async (response) => {
                    const path = ".temp/video.mp4";
                    if (!fs.existsSync("./.temp/")) {
                        fs.mkdirSync("./.temp/");
                    }

                    const writer = fs.createWriteStream(path);

                    response.data.pipe(writer);

                    writer.on("finish", async () => {
                        const videoName = (
                            await fileManager.uploadFile(path, {
                                mimeType: "video/mp4",
                                displayName: path,
                            })
                        ).file.name;

                        let video = await fileManager.getFile(videoName);
                        while (video.state === FileState.PROCESSING) {
                            await new Promise((resolve) =>
                                setTimeout(resolve, 500),
                            );
                            video = await fileManager.getFile(videoName);
                            if (video.state !== FileState.PROCESSING) {
                                fs.unlinkSync(path);
                                res(video.uri);
                            }
                        }
                    });
                },
            );
        });

        return uri;
    }
}

async function uploadFile(url) {
    return await new Promise((res, rej) => {
        try {
            const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
            axios({ method: "get", url: url, responseType: "stream" }).then(
                async (response) => {
                    let mimeType = response.headers["content-type"];
                    mimeType = mimeType === "application/binary" ? "video/mp4" : mimeType;
                    if (!fs.existsSync("./.temp/")) {
                        fs.mkdirSync("./.temp/");
                    }
                    const path = mimeType.split("/")[0] === "image" ? ".temp/image.png" : mimeType.split("/")[0] === "video" ? ".temp/video.mp4" : ".temp/audio.mp3";
    
                    const writer = fs.createWriteStream(path);
    
                    response.data.pipe(writer);
                    writer.on("finish", async () => {   
                        const fileName = (
                            await fileManager.uploadFile(path, {
                                mimeType: mimeType,
                                displayName: path,
                            })
                        ).file.name;
    
                        let file = await fileManager.getFile(fileName);
                        if (file.state === FileState.ACTIVE) {
                            fs.unlinkSync(path);
                            res(file.uri);
                        }
                        while (file.state === FileState.PROCESSING) {
                            await new Promise((resolve) =>
                                setTimeout(resolve, 500),
                            );
                            file = await fileManager.getFile(fileName);
                            if (file.state !== FileState.PROCESSING) {
                                fs.unlinkSync(path);
                                res(file.uri);
                            }
                        }
                    });
                },
            );
        } catch (error) {
            console.error(error);
            res("URL is not valid");
        }
    });
}

// TODO: delete this shi
app.post("/v1/filemanager/upload", async (req, res) => {
    GEMINI_API_KEY = req.headers.authorization.split("Bearer ")[1];

    const response = await uploadFile(req.body.url)
    if (response === "URL is not valid") {
        res.status(500).send("URL is not valid");
    }

    res.send(response);
})

app.post("/v1/chat/completions", async (req, res) => {
    try {
        const request = req.body;

        GEMINI_API_KEY = req.headers.authorization.split("Bearer ")[1];

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        let modelName = modelMap[request.model] || request.model;

        const model = genAI.getGenerativeModel({ model: modelName });

        let contnts = [];

        for (let message of request.messages) {
            let newcontent = [];
            if (typeof message.content === "string") {
                newcontent.push({ text: message.content });
            } else {
                for (let item of message.content) {
                    if (item?.type === "text") {
                        newcontent.push({ text: item.text });
                    } else if (item?.type === "image_url") {
                        if (
                            item.image_url.url.startsWith(
                                "https://generativelanguage.googleapis.com/v1beta/files/",
                            )
                        ) {
                            newcontent.push({
                                fileData: {
                                    fileUri: item.image_url.url,
                                    mimeType: "image/png",
                                },
                            });
                        } else {
                            const imageData = await getData(
                                item.image_url.url,
                                "image",
                            );
                            newcontent.push({
                                inlineData: {
                                    data: imageData,
                                    mimeType: "image/png",
                                },
                            });
                        }
                    } else if (item?.type === "audio_url") {
                        if (
                            item.audio_url.url.startsWith(
                                "https://generativelanguage.googleapis.com/v1beta/files/",
                            )
                        ) {
                            newcontent.push({
                                fileData: {
                                    fileUri: item.audio_url.url,
                                    mimeType: "audio/mp3",
                                },
                            });
                        } else {
                            const audioData = await getData(
                                item.audio_url.url,
                                "audio",
                            );
                            newcontent.push({
                                inlineData: {
                                    data: audioData,
                                    mimeType: "audio/mp3",
                                },
                            });
                        }
                    } else if (item?.type === "video_url") {
                        if (!item.video_url.url.startsWith("https://generativelanguage.googleapis.com/v1beta/files/")) {
                            item.video_url.url = await uploadFile(item.video_url.url)
                            if (item.video_url.url === "URL is not valid") {
                                res.status(500).send("URL is not valid");
                            }
                        }
                        newcontent.push({
                            fileData: {
                                fileUri: item.video_url.url,
                                mimeType: "video/mp4",
                            },
                        });
                    }
                }
            }
            if (message.role === "assistant") {
                message.role = "model";
            }

            if (message.role === "system") {
                contnts.push({ role: "user", parts: newcontent });
            } else {
                contnts.push({
                    role: message.role,
                    parts: newcontent,
                });
            }
        }

        const safeSett = [
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ];

        if (request.stream) {
            const resp = await model.generateContentStream({
                contents: contnts,
                safetySettings: safeSett,
            });

            const readableStream = new Readable({
                read() {},
            });

            pipeline(readableStream, res).catch((err) => {
                console.error("Pipeline error:", err);
                res.status(500).send("Internal Server Error");
            });

            for await (const chunk of resp.stream) {
                readableStream.push(
                    "data: " +
                        JSON.stringify({
                            id: "chatcmpl-abc123",
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1000),
                            model: request.model,
                            choices: [
                                {
                                    delta: {
                                        role: "assistant",
                                        content: chunk.text(),
                                    },
                                    finish_reason: null,
                                    index: 0,
                                },
                            ],
                        }) +
                        "\n\n",
                );
            }
            readableStream.push("data: [DONE]\n\n");
            readableStream.push(null);
        } else {
            const resp = (
                await model.generateContent({
                    contents: contnts,

                    safetySettings: safeSett,
                })
            ).response.text();

            res.json({
                id: "chatcmpl-abc123",
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: req.model,
                choices: [
                    {
                        message: { role: "model", content: resp },
                        finish_reason: "stop",
                        index: 0,
                        logprobs: null,
                    },
                ],
            });
        }
    } catch (error) {
        console.error(error);

        res.status(500).send(error.message);
    }
});

app.get("/v1/models", async (req, res) => {
    res.json({
        object: "list",
        data: modelsList,
    });
});

app.listen(3333, () => {
    console.log("Server running on port 3333");
});

export default app;
