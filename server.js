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
        const finalPrompt = `Title: ${artTitle}\nExportCSV = ${exportCSV}\n\n${prompt}`;

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: "You are an expert art critic. Analyze the given image." },
                    { role: "user", content: [{ type: "text", text: finalPrompt }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } } ] }
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

        // ✅ Extract CSV Data (if enabled)
        let factorsCSV = "";
        let questionsCSV = "";

        if (exportCSV === "Yes") {
            const csvRegex = /```csv\s*([\s\S]+?)\s*```/g;

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

            // ✅ Save CSV files if found
            if (factorsCSV) {
                fs.writeFileSync(path.join(__dirname, "public", "factors.csv"), factorsCSV, "utf8");
                console.log("✅ Factors CSV saved.");
            }
            if (questionsCSV) {
                fs.writeFileSync(path.join(__dirname, "public", "questions.csv"), questionsCSV, "utf8");
                console.log("✅ Questions CSV saved.");
            }

            // ✅ Remove CSV data from final response
            analysisText = analysisText.replace(csvRegex, "").trim();
        }

        res.json({
            analysis: analysisText,
		csvLinks: (exportCSV === "Yes" && (factorsCSV || questionsCSV)) ? {
  		  factorsCSV: factorsCSV ? "/factors.csv" : "#",
   		 questionsCSV: questionsCSV ? "/questions.csv" : "#"
		} : null
        });

    } catch (error) {
        console.error("🔴 OpenAI API Error:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.error?.message || "OpenAI request failed" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
