import express from "express";
import fs from "fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { GoogleGenerativeAI } from "@google/generative-ai";
import modelsList from "./src/models.js";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import axios from "axios";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

const app = express();
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb" }));

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
                        process.stdout.write(`Processing ${videoName}.`);
                        while (video.state === FileState.PROCESSING) {
                            await new Promise((resolve) =>
                                setTimeout(resolve, 500),
                            );
                            process.stdout.write(".");
                            video = await fileManager.getFile(videoName);
                            if (video.state !== FileState.PROCESSING) {
                                console.log(`\n${videoName} processed.`);
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

app.post("/v1/chat/completions", async (req, res) => {
    try {
        const request = req.body;

        GEMINI_API_KEY = req.headers.authorization.split("Bearer ")[1];

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: request.model });

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
                    } else if (item?.type === "audio_url") {
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
                    } else if (item?.type === "video_url") {
                        const uri = await getData(item.video_url.url, "video");

                        newcontent.push({
                            fileData: {
                                fileUri: uri,
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

            res.setHeader("Content-Type", "application/json");
            res.setHeader("Transfer-Encoding", "chunked");

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
            res.end()
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
    console.log("Proxy server running on port 3333");
});

export default app;
