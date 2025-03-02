require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs"); // ✅ File system module to save CSV files
const path = require("path");

const app = express();

// ✅ Allow larger image sizes (50MB)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());

// Serve static files from the "public" folder (for downloading CSVs)
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // ✅ Load API key securely

app.post("/analyze", async (req, res) => {
    try {
        const { prompt, image, artTitle } = req.body;

        if (!prompt || !image) {
            return res.status(400).json({ error: "Prompt and image are required" });
        }

        // ########################### CSV TOGGLE ################################ 
        // ✅ Toggle CSV Export (Set to "Yes" for debugging, "No" for normal mode)
        const exportCSV = "Yes";  // Change to "No" when you don't need CSVs
        const finalPrompt = `ExportCSV = ${exportCSV}\n\nUser-provided Artwork Title: "${artTitle}". Ensure this title appears **only once** in the final report, directly under "Analysis of Skill Mastery". Do NOT print the title anywhere else in the response.\n\n${prompt}`;


        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: "You are an expert art critic. Analyze the given image." },
                    { role: "user", content: [
                        { type: "text", text: finalPrompt },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }
                    ]}
                ],
                max_tokens: 4096
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENAI_API_KEY}`
                }
            }
        );

        let analysisText = response.data.choices[0].message.content;

        // ✅ Debugging Log: Show Full OpenAI Response
        console.log("🔍 Full AI Response:\n", analysisText);

        // ✅ Extract CSV Data (if enabled)
        let factorsCSV = "";
        let questionsCSV = "";
        let csvLinks = null;

        if (exportCSV === "Yes") {
            const csvRegex = /```csv\n([\s\S]+?)\n```/g;
            let match;
            let csvFiles = 0;

            while ((match = csvRegex.exec(analysisText)) !== null) {
                csvFiles++;
                if (csvFiles === 1) {
                    factorsCSV = match[1];
                } else if (csvFiles === 2) {
                    questionsCSV = match[1];
                }
            }

            // ✅ Debugging Log: Show Extracted CSV Data
            console.log("✅ Extracted CSV Data:");
            console.log("Factors CSV:\n", factorsCSV);
            console.log("Questions CSV:\n", questionsCSV);

            // ✅ Save CSV files if found
            if (factorsCSV) {
                const factorsPath = path.join(__dirname, "public", "factors.csv");
                fs.writeFileSync(factorsPath, factorsCSV, "utf8");
                console.log(`✅ Factors CSV saved at ${factorsPath}`);
            }
            if (questionsCSV) {
                const questionsPath = path.join(__dirname, "public", "questions.csv");
                fs.writeFileSync(questionsPath, questionsCSV, "utf8");
                console.log(`✅ Questions CSV saved at ${questionsPath}`);
            }

            // ✅ Ensure CSV download links are provided
            csvLinks = {
                factorsCSV: factorsCSV ? "/factors.csv" : null,
                questionsCSV: questionsCSV ? "/questions.csv" : null
            };

            // ✅ Remove CSV data from final response
            analysisText = analysisText.replace(csvRegex, "").trim();
        }

        // ✅ Debugging Log: Show Final API Response Sent to UI
        const finalResponse = {
            analysis: `### Title: ${artTitle}\n\n${analysisText}`, // ✅ Ensure Title is included
            csvLinks: csvLinks
        };
        console.log("✅ Final API Response:", JSON.stringify(finalResponse, null, 2));

        res.json(finalResponse);

    } catch (error) {
        console.error("🔴 OpenAI API Error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.error?.message || "OpenAI request failed" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
