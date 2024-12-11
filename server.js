import express from "express";
import fs from "fs";
import cors from "cors";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
    GoogleGenerativeAI,
    HarmBlockThreshold,
    HarmCategory,
} from "@google/generative-ai";
import { modelsList, modelMap } from "./src/models.js";
import axios from "axios";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import os from "os";

const app = express();
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));
app.use(cors());

const port = process.env.PORT || 3333;
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
        const uri = await new Promise(async (res, rej) => {
            let path;
            try {
                const response = await axios({
                    method: "get",
                    url,
                    responseType: "stream",
                });
                path = `.temp/video_${Math.random().toString(36).substring(2, 7)}.mp4`;

                if (!fs.existsSync("./.temp/")) {
                    fs.mkdirSync("./.temp/");
                }

                const writer = fs.createWriteStream(path);
                response.data.pipe(writer);

                writer.on("finish", async () => {
                    try {
                        const videoName = (
                            await fileManager.uploadFile(path, {
                                mimeType: "video/mp4",
                                displayName: path,
                            })
                        ).file.name;

                        let retries = 0;
                        const maxRetries = 10;

                        let video = await fileManager.getFile(videoName);

                        while (
                            video.state === FileState.PROCESSING &&
                            retries < maxRetries
                        ) {
                            await new Promise((resolve) =>
                                setTimeout(resolve, 500),
                            );
                            video = await fileManager.getFile(videoName);
                            retries++;
                        }

                        if (
                            video.state === FileState.ACTIVE ||
                            video.state === FileState.FAILED
                        ) {
                            fs.unlinkSync(path);
                            res(video.uri);
                        } else {
                            rej(
                                new Error(
                                    "Video processing timed out or failed.",
                                ),
                            );
                        }
                    } catch (uploadError) {
                        console.error("File upload error:", uploadError);
                        fs.unlinkSync(path);
                        rej(uploadError);
                    }
                });

                writer.on("error", (err) => {
                    if (path) fs.unlinkSync(path);
                    rej(err);
                });
            } catch (axiosError) {
                if (path) fs.unlinkSync(path);
                rej(axiosError);
            }
        });
        return uri;
    }
}

async function uploadFile(url) {
    return new Promise(async (res, rej) => {
        let path = "";
        try {
            const fileManager = new GoogleAIFileManager(GEMINI_API_KEY);
            const response = await axios({
                method: "get",
                url,
                responseType: "stream",
            }).catch(rej);

            if (!response) return;

            let mimeType = response.headers["content-type"];
            mimeType =
                mimeType === "application/binary" ? "video/mp4" : mimeType;
            if (!fs.existsSync("./.temp/")) {
                fs.mkdirSync("./.temp/");
            }

            const id = Math.random().toString(36).substring(2, 7);

            path =
                mimeType.split("/")[0] === "image"
                    ? `.temp/image_${id}.png`
                    : mimeType.split("/")[0] === "video"
                      ? `.temp/video_${id}.mp4`
                      : `.temp/audio_${id}.mp3`;

            const writer = fs.createWriteStream(path);

            response.data.pipe(writer);
            writer.on("finish", async () => {
                try {
                    const fileName = (
                        await fileManager.uploadFile(path, {
                            mimeType,
                            displayName: path,
                        })
                    ).file.name;

                    let retries = 0;
                    const maxRetries = 10;
                    let file = await fileManager.getFile(fileName);
                    while (
                        file.state === FileState.PROCESSING &&
                        retries < maxRetries
                    ) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, 500),
                        );
                        file = await fileManager.getFile(fileName);
                        if (file.state !== FileState.PROCESSING) {
                            fs.unlinkSync(path);
                            res(file.uri);
                            return;
                        }

                        retries++;
                    }

                    if (file.state === FileState.ACTIVE) {
                        fs.unlinkSync(path);
                        res(file.uri);
                        return;
                    }

                    throw new Error("File processing timed out.");
                } catch (uploadError) {
                    console.error("File upload error:", uploadError);
                    fs.unlinkSync(path);
                    rej(uploadError);
                }
            });
            writer.on("error", (err) => {
                if (path) fs.unlinkSync(path);
                rej(err);
            });
        } catch (error) {
            console.error("Upload File Error:", error);
            if (path) {
                fs.unlinkSync(path);
            }
            rej("URL is not valid");
        }
    });
}

app.post("/v1/filemanager/upload", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res
                .status(401)
                .send("Unauthorized: Missing or invalid Authorization header");
        }

        GEMINI_API_KEY = authHeader.split("Bearer ")[1];
        const response = await uploadFile(req.body.url);
        res.send(response);
    } catch (error) {
        console.error("Error in /v1/filemanager/upload:", error);

        res.status(500).send(error.message || "Internal Server Error");
    }
});

app.post("/v1/chat/completions", async (req, res) => {
    try {
        const request = req.body;
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).send("Unauthorized");
        }
        GEMINI_API_KEY = authHeader.split("Bearer ")[1];

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        let modelName = modelMap[request.model] || (
            modelsList.map((model) => model.id).includes(request.model) ?
                request.model :
                modelMap["gpt-4o-mini"]
        );

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
                        if (
                            !item.video_url.url.startsWith(
                                "https://generativelanguage.googleapis.com/v1beta/files/",
                            )
                        ) {
                            item.video_url.url = await uploadFile(
                                item.video_url.url,
                            );
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
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Transfer-Encoding', 'chunked');

            try {
                for await (const chunk of resp.stream) {
                    res.write(
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
                res.write("data: [DONE]\n\n");
                res.end();
            } catch (err) {
                // Error handling within the streaming section
                if (
                    err instanceof Error &&
                    err.message.includes("Text not available") &&
                    err.message.includes("Response was blocked due to")
                ) {
                    // Handle blocked response without logging to console
                    res.status(400).send({
                        error: err.message,
                    });
                } else {
                    console.error("Stream error:", err);
                    res.status(500).send("Internal Server Error");
                }
            }
        } else {
            // Prepare the prompt contents for token counting
            let promptContents = [];
            for (const message of request.messages) {
                if (message.role !== "assistant") {
                    // Include system and user messages
                    promptContents.push({
                        role: message.role === "system" ? "user" : message.role, // System messages become "user" for counting
                        parts:
                            typeof message.content === "string"
                                ? [{ text: message.content }]
                                : message.content,
                    });
                }
            }

            const tokenUsage = await model.countTokens({ contents: contnts });
            const promptTokenCount = await model.countTokens({
                contents: promptContents,
            });
            const resp = await model.generateContent({
                contents: contnts,
                safetySettings: safeSett,
            });

            let responseText = "";
            if (
                resp &&
                resp.response &&
                typeof resp.response.text === "function"
            ) {
                responseText = resp.response.text();

                res.json({
                    id: "cmpl-5v8k3",
                    object: "chat.completion",
                    created: Math.floor(Date.now() / 1000),
                    model: request.model,
                    choices: [
                        {
                            message: {
                                role: "assistant",
                                content: responseText,
                            },
                            finish_reason: "stop",
                            index: 0,
                            logprobs: null,
                        },
                    ],
                    usage: {
                        prompt_tokens: promptTokenCount.totalTokens,
                        completion_tokens:
                            tokenUsage.totalTokens - promptTokenCount.totalTokens,
                        total_tokens: tokenUsage.totalTokens,
                    },
                });
            } else {
                console.error("Unexpected response format from Gemini:", resp);
                return res
                    .status(500)
                    .send(
                        "Internal Server Error: Unexpected response format from Gemini",
                    );
            }
        }
    } catch (error) {
        if (error.status === 429) {
            // Check for 429 status code
            res.status(503).send({
                error: "Too many requests, please try again later.",
            });
        } else if (
            error instanceof Error &&
            error.message.includes("Text not available") &&
            error.message.includes("Response was blocked due to")
        ) {
            // Handle blocked response without logging to console
            res.status(400).send({
                error: error.message,
            });
        } else {
            console.error("Chat Completions Error:", error);
            res.status(500).send(error.message || "Internal Server Error");
        }
    }
});

app.get("/v1/models", async (req, res) => {
    res.json({
        object: "list",
        data: modelsList,
    });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);

    const interfaces = os.networkInterfaces();

    for (const interfaceName in interfaces) {
        for (const details of interfaces[interfaceName]) {
            if (details.family === "IPv4" && !details.internal) {
                console.log(`Listening on ${details.address}:${port}`);
            }
        }
    }
});

export default app;
