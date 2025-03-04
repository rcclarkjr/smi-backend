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
        const { prompt, image, artTitle, artistName } = req.body;

        if (!prompt || !image) {
            return res.status(400).json({ error: "Prompt and image are required" });
        }

        // Toggle CSV Export (Set to "Yes" for debugging, "No" for normal mode)
        const exportCSV = "Yes";
        
        // Ensure we're using the modified prompt for GPT-4
        // First check if the prompt contains our modified instructions; if not, use the hardcoded version
        const promptHasModifications = prompt.includes("IMPORTANT: You only need to fill in the Score column for the Questions Table with 1 (Yes) or 0 (No)");
        
        // Construct the prompt with art title and artist name
        let finalPrompt;
        let artistInfo = artistName ? `Artist: "${artistName}"` : "";
        
        if (promptHasModifications) {
            finalPrompt = `ExportCSV = ${exportCSV}\n\nUser-provided Artwork Title: "${artTitle}". ${artistInfo}\nThe prompt will handle where to place this information.\n\n${prompt}`;
        } else {
            // Use our hardcoded modified prompt that ensures the backend calculates scores
            finalPrompt = `ExportCSV = ${exportCSV}\n\nUser-provided Artwork Title: "${artTitle}". ${artistInfo}\nThe prompt will handle where to place this information.\n\nPrompt details would go here...`;
        }

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { 
                        role: "system", 
                        content: "You are an expert art critic. Analyze the given image. When instructed to export CSV data, format it precisely within code blocks labeled as csv. For the Factors Table, include ALL 33 factors. For the Questions Table, include ALL 165 questions with scores of 1 (Yes) or 0 (No). DO NOT calculate the Scores in the Factors Table - the backend will do this calculation." 
                    },
                    { 
                        role: "user", 
                        content: [
                            { type: "text", text: finalPrompt },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }
                        ]
                    }
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

        // Remove any userStyle tags from the response
        analysisText = analysisText.replace(/<userStyle>.*?<\/userStyle>/g, '');

        // Extract CSV Data (if enabled)
        let factorsCSV = "";
        let questionsCSV = "";
        let csvLinks = null;

        // Save the image to serve it via URL
        let imageUrl = null;
        try {
            // Create public dir if it doesn't exist
            const publicDir = path.join(__dirname, "public");
            if (!fs.existsSync(publicDir)) {
                fs.mkdirSync(publicDir);
            }
            
            // Save the image with a unique filename (timestamp + sanitized title)
            const timestamp = Date.now();
            const sanitizedTitle = artTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const imageFilename = `${timestamp}-${sanitizedTitle}.jpg`;
            const imagePath = path.join(publicDir, imageFilename);
            
            // Convert base64 to buffer and save
            const imageBuffer = Buffer.from(image, 'base64');
            fs.writeFileSync(imagePath, imageBuffer);
            
            // Set the image URL for the response
            imageUrl = `https://smi-backend-8n2f.onrender.com/${imageFilename}`;
            console.log(`✅ Artwork image saved at ${imagePath}`);
        } catch (err) {
            console.error("Error saving image:", err);
            // Continue even if image saving fails
        }

        if (exportCSV === "Yes") {
            const csvRegex = /```csv\s*([\s\S]+?)\s*```/g;
            let match;
            let csvFiles = 0;

            while ((match = csvRegex.exec(analysisText)) !== null) {
                csvFiles++;
                if (csvFiles === 1) {
                    factorsCSV = match[1].trim();
                    console.log("Raw Factors CSV extracted:", factorsCSV);
                } else if (csvFiles === 2) {
                    questionsCSV = match[1].trim();
                    console.log("Raw Questions CSV extracted:", questionsCSV);
                }
            }
            
            // Verify if we extracted both CSV tables
            if (!factorsCSV || !questionsCSV) {
                console.log("⚠️ WARNING: Did not extract both CSV tables from AI response.");
                console.log("Factors CSV found:", !!factorsCSV);
                console.log("Questions CSV found:", !!questionsCSV);
            }

            // Process Questions CSV to calculate Factor scores
            if (questionsCSV) {
                // Parse Questions CSV
                const questionsLines = questionsCSV.trim().split('\n');
                console.log(`Questions CSV has ${questionsLines.length} lines`);
                
                // Check if we have the expected number of question lines
                if (questionsLines.length < 165) {
                    console.log("⚠️ WARNING: Questions CSV has fewer than 165 lines");
                }
                
                const questionsHeader = questionsLines[0].split(',');
                console.log("Questions header fields:", questionsHeader);
                
                const factorIndex = questionsHeader.indexOf('Factor');
                const scoreIndex = questionsHeader.indexOf('Score');
                
                // Verify we found the expected columns
                if (factorIndex === -1 || scoreIndex === -1) {
                    console.log("⚠️ ERROR: Could not find Factor or Score column in Questions CSV");
                    console.log(`Factor index: ${factorIndex}, Score index: ${scoreIndex}`);
                }
                
                if (factorIndex !== -1 && scoreIndex !== -1) {
                    // Create a map to collect all question scores by factor
                    const factorScores = {};
                    
                    // Function to parse CSV line with proper handling of quoted fields
                    function parseCSVLine(line) {
                        const fields = [];
                        let inQuote = false;
                        let field = '';
                        
                        for (let i = 0; i < line.length; i++) {
                            const char = line[i];
                            
                            if (char === '"') {
                                // If we encounter a double quote
                                if (i + 1 < line.length && line[i + 1] === '"') {
                                    // Escaped quote inside a quoted field
                                    field += '"';
                                    i++; // Skip the next quote
                                } else {
                                    // Toggle the in-quote flag
                                    inQuote = !inQuote;
                                }
                            } else if (char === ',' && !inQuote) {
                                // End of a field
                                fields.push(field);
                                field = '';
                            } else {
                                // Regular character
                                field += char;
                            }
                        }
                        
                        // Don't forget the last field
                        fields.push(field);
                        
                        return fields;
                    }
                    
                    // Skip header row
                    for (let i = 1; i < questionsLines.length; i++) {
                        try {
                            const row = questionsLines[i];
                            if (!row.trim()) continue; // Skip empty rows
                            
                            const fields = parseCSVLine(row);
                            
                            // Get factor and score from the parsed fields
                            let factor = '';
                            let score = 0;
                            
                            if (fields.length > factorIndex) {
                                factor = fields[factorIndex].replace(/^"|"$/g, '').trim(); // Remove quotes if present
                            }
                            
                            if (fields.length > scoreIndex) {
                                const scoreStr = fields[scoreIndex].trim();
                                score = (scoreStr === '1' || scoreStr === '"1"') ? 1 : 0;
                            }
                            
                            if (!factor) {
                                console.log(`Warning: Empty factor on line ${i+1}:`, row);
                                continue;
                            }
                            
                            if (!factorScores[factor]) {
                                factorScores[factor] = [];
                            }
                            
                            factorScores[factor].push(score);
                        } catch (err) {
                            console.error(`Error parsing line ${i+1}:`, questionsLines[i], err);
                        }
                    }
                    
                    console.log("Extracted factors with scores:", Object.keys(factorScores).length);
                    for (const [factor, scores] of Object.entries(factorScores)) {
                        console.log(`${factor}: ${scores.length} scores`);
                    }
                    
                    // Calculate factor scores by summing the question scores
                    const factorTotals = {};
                    for (const [factor, scores] of Object.entries(factorScores)) {
                        factorTotals[factor] = scores.reduce((sum, score) => sum + score, 0);
                    }
                    
                    // Parse and update Factors CSV with calculated integer scores
                    if (factorsCSV) {
                        const factorsLines = factorsCSV.trim().split('\n');
                        console.log(`Factors CSV has ${factorsLines.length} lines`);
                        
                        // Check if we have the expected number of factor lines
                        if (factorsLines.length < 33) {
                            console.log("⚠️ WARNING: Factors CSV has fewer than 33 lines");
                        }
                        
                        const factorsHeader = factorsLines[0];
                        const updatedFactorsLines = [factorsHeader];
                        
                        // Skip header row
                        for (let i = 1; i < factorsLines.length; i++) {
                            try {
                                const line = factorsLines[i];
                                if (!line.trim()) continue; // Skip empty lines
                                
                                const parts = parseCSVLine(line);
                                if (parts.length < 3) {
                                    console.log(`Warning: Skipping invalid factor line: ${line}`);
                                    continue;
                                }
                                
                                const factorName = parts[1].replace(/^"|"$/g, '').trim(); // Remove quotes if present
                                let weight = 0;
                                
                                // Handle the weight field, which might be formatted as "5.00%" or "0.05"
                                if (parts[2].includes('%')) {
                                    weight = parseFloat(parts[2].replace('%', '')) / 100;
                                } else {
                                    weight = parseFloat(parts[2]);
                                }
                                
                                // Check if we have a valid weight
                                if (isNaN(weight)) {
                                    console.log(`Warning: Invalid weight for ${factorName}: ${parts[2]}`);
                                    weight = 0;
                                }
                                
                                // Calculate the score, extend and BFB values
                                if (factorTotals[factorName] !== undefined) {
                                    const score = factorTotals[factorName];
                                    const extend = (score * weight).toFixed(4);
                                    const bfb = score === 0 ? "N/A" : (weight / score).toFixed(2);
                                    
                                    // Reconstruct the line with the calculated score
                                    parts[3] = score; // Integer score
                                    parts[4] = extend;
                                    parts[5] = bfb;
                                    updatedFactorsLines.push(parts.join(','));
                                    
                                    console.log(`Updated ${factorName} with score ${score}, extend ${extend}, BFB ${bfb}`);
                                } else {
                                    console.log(`Warning: No scores found for factor: ${factorName}`);
                                    // Keep the original line but set score to 0
                                    parts[3] = 0;
                                    parts[4] = 0;
                                    parts[5] = "N/A";
                                    updatedFactorsLines.push(parts.join(','));
                                }
                            } catch (err) {
                                console.error(`Error processing factor line ${i+1}:`, factorsLines[i], err);
                            }
                        }
                        
                        // Check how many factors we processed
                        console.log(`Updated ${updatedFactorsLines.length - 1} factor lines`);
                        
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
            
            // Ensure proper Markdown rendering by adding line breaks between sections
            analysisText = analysisText
                .replace(/^##\s+/gm, "\n## ") // Add empty line before headings
                .replace(/^###\s+/gm, "\n### ") // Add empty line before subheadings
                .replace(/\n\n\n+/g, "\n\n"); // Remove excessive line breaks
            
            // Calculate and include the SMI in the analysis
            if (factorsCSV) {
                const factorsLines = factorsCSV.trim().split('\n');
                let totalExtend = 0;
                
                // Skip header row
                for (let i = 1; i < factorsLines.length; i++) {
                    try {
                        const line = factorsLines[i].trim();
                        if (!line) continue;
                        
                        const parts = parseCSVLine(line);
                        if (parts.length >= 5) {
                            const extend = parseFloat(parts[4]);
                            if (!isNaN(extend)) {
                                totalExtend += extend;
                            }
                        }
                    } catch (err) {
                        console.error(`Error calculating SMI for line ${i+1}:`, factorsLines[i], err);
                    }
                }
                
                // Round to 1 decimal place
                const smi = totalExtend.toFixed(1);
                console.log(`Calculated SMI: ${smi}`);
                
                // Replace SMI placeholder in the analysis text if it exists
                analysisText = analysisText.replace(/{{SMI}}/g, smi);
            }
        }

        // Remove any remaining userStyle tags
        analysisText = analysisText.replace(/<userStyle>.*?<\/userStyle>/g, '');

        const finalResponse = {
            analysis: analysisText,
            csvLinks: csvLinks,
            imageUrl: imageUrl
        };

        console.log("✅ Final API Response:", JSON.stringify(finalResponse, null, 2));

        res.