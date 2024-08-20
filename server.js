import express from "express";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import modelsList from "./src/models.js";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import axios from "axios";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

const app = express();
app.use(express.json());

let GEMINI_API_KEY;
async function getData(url, type) {
    const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);

    let data;

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

            for (let item of message.content) {
                if (item?.type === "text") {
                    newcontent.push({ text: item.text });
                } else if (typeof item === "string") {
                    newcontent.push({ text: item });
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
            if (message.role === "assistant") {
                message.role = "model";
            }

            if (message.role === "system") {
                contnts.push({ role: "user", parts: newcontent });
                contnts.push({ role: "model", parts: [{ text: "" }] });
            } else {
                contnts.push({
                    role: message.role,
                    parts: newcontent,
                });
            }
        }

        const resp = (
            await model.generateContent({
                contents: contnts,

                safetySettings: [
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
                ],
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
    } catch (error) {
        console.error(
            "Error:",
            error.response ? error.response.data : error.message,
        );
        res.status(500).send(error.message);
    }
});

app.get("/v1/models", async (req, res) => {
    res.json({
        object: "list",
        data: modelsList,
    });
});

// app.listen(3000, () => {
//    console.log("Proxy server running on port 3000");
// });

export default app;
