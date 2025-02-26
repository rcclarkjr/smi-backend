require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

// ✅ Allow larger image sizes (50MB)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());

// Serve static files from the "public" folder
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // ✅ Load API key securely

app.post("/analyze", async (req, res) => {
    try {
        const { prompt, image } = req.body;

        if (!prompt || !image) {
            return res.status(400).json({ error: "Prompt and image are required" });
        }

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: "You are an expert art critic. Analyze the given image." },
                    { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } } ] }
                ],
                max_tokens: 1000
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENAI_API_KEY}`
                }
            }
        );

        res.json({ analysis: response.data.choices[0].message.content });

    } catch (error) {
        console.error("🔴 OpenAI API Error:", error.response?.data || error.message); // ✅ LOG ERROR DETAILS
        res.status(500).json({ error: error.response?.data?.error?.message || "OpenAI request failed" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
