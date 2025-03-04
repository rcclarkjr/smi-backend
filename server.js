require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();

// Allow larger image sizes (50MB)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());

// Serve static files from the "public" folder (for downloading CSVs)
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/analyze", async (req, res) => {
    try {
        const { prompt, image, artTitle } = req.body;

        if (!prompt || !image) {
            return res.status(400).json({ error: "Prompt and image are required" });
        }

        // Toggle CSV Export (Set to "Yes" for debugging, "No" for normal mode)
        const exportCSV = "Yes";
        
        const finalPrompt = `ExportCSV = ${exportCSV}\n\nUser-provided Artwork Title: "${artTitle}". The prompt will handle where to place this title.\n\n${prompt}`;

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: "You are an expert art critic. Analyze the given image. When instructed to export CSV data, format it precisely within ```csv code blocks. Only answer the 165 questions with 1 (Yes) or 0 (No) in the Questions Table. DO NOT calculate the Scores for the Factors Table." },
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

        // Debugging Log: Show Full OpenAI Response
        console.log("🔍 Full AI Response:\n", analysisText);

        // Extract CSV Data (if enabled)
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

            // Process Questions CSV to calculate Factor scores
            if (questionsCSV) {
                // Parse Questions CSV
                const questionsLines = questionsCSV.trim().split('\n');
                const questionsHeader = questionsLines[0].split(',');
                const factorIndex = questionsHeader.indexOf('Factor');
                const scoreIndex = questionsHeader.indexOf('Score');
                
                if (factorIndex !== -1 && scoreIndex !== -1) {
                    // Create a map to collect all question scores by factor
                    const factorScores = {};
                    
                    // Skip header row
                    for (let i = 1; i < questionsLines.length; i++) {
                        const questionData = questionsLines[i].split(',');
                        const factor = questionData[factorIndex].replace(/^"|"$/g, ''); // Remove quotes if present
                        const score = parseInt(questionData[scoreIndex]);
                        
                        if (!factorScores[factor]) {
                            factorScores[factor] = [];
                        }
                        
                        factorScores[factor].push(score);
                    }
                    
                    // Calculate factor scores by summing the question scores
                    const factorTotals = {};
                    for (const [factor, scores] of Object.entries(factorScores)) {
                        factorTotals[factor] = scores.reduce((sum, score) => sum + score, 0);
                    }
                    
                    // Parse and update Factors CSV with calculated integer scores
                    if (factorsCSV) {
                        const factorsLines = factorsCSV.trim().split('\n');
                        const factorsHeader = factorsLines[0];
                        const updatedFactorsLines = [factorsHeader];
                        
                        // Skip header row
                        for (let i = 1; i < factorsLines.length; i++) {
                            const parts = factorsLines[i].split(',');
                            const factorName = parts[1].replace(/^"|"$/g, ''); // Remove quotes if present
                            const weight = parseFloat(parts[2].replace('%', '')) / 100;
                            
                            if (factorTotals[factorName] !== undefined) {
                                const score = factorTotals[factorName];
                                const extend = (score * weight).toFixed(4);
                                const bfb = score === 0 ? "N/A" : (weight / score).toFixed(2);
                                
                                // Reconstruct the line with the calculated score
                                parts[3] = score; // Integer score
                                parts[4] = extend;
                                parts[5] = bfb;
                                updatedFactorsLines.push(parts.join(','));
                            } else {
                                // Keep the original line if no calculated score is available
                                updatedFactorsLines.push(factorsLines[i]);
                            }
                        }
                        
                        // Update factorsCSV with the calculated scores
                        factorsCSV = updatedFactorsLines.join('\n');
                    }
                }
            }

            // Debug: Show processed CSV data
            console.log("✅ Processed CSV Data:");
            console.log("Factors CSV with calculated scores:\n", factorsCSV);
            console.log("Questions CSV:\n", questionsCSV);

            // Create public dir if it doesn't exist
            const publicDir = path.join(__dirname, "public");
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir);
            }
            
            // Save CSV files if found
            if (factorsCSV) {
                const factorsPath = path.join(publicDir, "factors.csv");
                fs.writeFileSync(factorsPath, factorsCSV, "utf8");
                console.log(`✅ Factors CSV saved at ${factorsPath}`);
            }
            if (questionsCSV) {
                const questionsPath = path.join(publicDir, "questions.csv");
                fs.writeFileSync(questionsPath, questionsCSV, "utf8");
                console.log(`✅ Questions CSV saved at ${questionsPath}`);
            }

            // Ensure CSV download links are provided
            csvLinks = {
                factorsCSV: factorsCSV ? "https://smi-backend-8n2f.onrender.com/factors.csv" : null,
                questionsCSV: questionsCSV ? "https://smi-backend-8n2f.onrender.com/questions.csv" : null
            };
            
            // Remove CSV data from final response
            analysisText = analysisText.replace(csvRegex, "").trim();
            
            // Calculate and include the SMI in the analysis
            if (factorsCSV) {
                const factorsLines = factorsCSV.trim().split('\n');
                let totalExtend = 0;
                
                // Skip header row
                for (let i = 1; i < factorsLines.length; i++) {
                    const parts = factorsLines[i].split(',');
                    if (parts.length >= 5) {
                        const extend = parseFloat(parts[4]);
                        if (!isNaN(extend)) {
                            totalExtend += extend;
                        }
                    }
                }
                
                // Round to 1 decimal place
                const smi = totalExtend.toFixed(1);
                
                // Replace SMI placeholder in the analysis text if it exists
                analysisText = analysisText.replace(/{{SMI}}/g, smi);
            }
        }

        const finalResponse = {
            analysis: analysisText,
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