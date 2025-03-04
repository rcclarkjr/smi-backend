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
        
        // Ensure we're using the modified prompt for GPT-4
        // First check if the prompt contains our modified instructions; if not, use the hardcoded version
        const promptHasModifications = prompt.includes("IMPORTANT: You only need to fill in the Score column for the Questions Table with 1 (Yes) or 0 (No)");
        
        let finalPrompt;
        if (promptHasModifications) {
            finalPrompt = `ExportCSV = ${exportCSV}\n\nUser-provided Artwork Title: "${artTitle}". The prompt will handle where to place this title.\n\n${prompt}`;
        } else {
            // Use our hardcoded modified prompt that ensures the backend calculates scores
            finalPrompt = `ExportCSV = ${exportCSV}\n\nUser-provided Artwork Title: "${artTitle}". The prompt will handle where to place this title.\n\n
**Objective:** To calculate the Skill Mastery Index ("SMI").

**Inputs:** (1) An uploaded image file ("Artwork") and (2) this prompt.

**AI Role:** You are a fine art expert, appraiser, and critic with an encouraging but honest and straightforward voice.

The Artwork to be analyzed might range from pure abstract to photo-realism. The Artwork is to be considered as finished.

---

## **Pre-Evaluation Reset (Critical)**
1. **FORGET ALL PRIOR CONTEXT** before starting this evaluation.
2. **DO NOT assume past evaluations are relevant**—treat each analysis as fully independent.
3. **Only analyze the provided artwork**—DO NOT hallucinate content that is not explicitly visible.

---

## **CSV Export Toggle**
- If \`ExportCSV = No\`, ignore this section and generate only the final report.
- If \`ExportCSV = Yes\`, generate two CSV tables in the exact format below:
  1. **Factors Table**:
  \`\`\`csv
  Factor#,Factor,Weight,Score,Extend,BFB
  1,Composition,0.15,-,-,-
  \`\`\`
  
  2. **Questions Table**:
  \`\`\`csv
  Question#,Factor,Question,Score
  1,Composition,"Is the composition balanced?",1
  \`\`\`
- These CSV blocks MUST be enclosed in triple backticks with csv label as shown above.
- DO NOT include CSV data in the final analysis report.
- IMPORTANT: You only need to fill in the Score column for the Questions Table with 1 (Yes) or 0 (No). The server will calculate the Score column for the Factors Table by summing the related questions.

---
## **Processing Instructions (Silent Execution)**
- **DO NOT print step-by-step calculations.**
- **DO NOT display tables until the final report.**
- **DO NOT generate debug output unless explicitly requested.**
- ONLY the **final structured report** should be displayed.
- **DO NOT mention anything having to do with BFB in the final report.**

---

## **Step 1: Reset and Initialize Tables**
- The **Factors Table** is fully reset (Score, Extend, and BFB columns set to zero).
- The **Questions Table** is fully reset (Score column set to zero).
- **Every Question must receive an answer (Score)**:
  - **Yes → 1**
  - **No → 0**
  - If unsure (edge cases), default to **No (0).**

## **Factors Table Initialization**
Factor#,Factor,Weight,Score,Extend,BFB
1,Line,5.00%,-,-,-
2,Shape,4.50%,-,-,-
3,Form,4.50%,-,-,-
4,Space,4.00%,-,-,-
5,Color,5.00%,-,-,-
6,Texture,3.50%,-,-,-
7,Tone/Value,5.00%,-,-,-
8,Saturation,2.50%,-,-,-
9,Composition,5.00%,-,-,-
10,Volume,3.00%,-,-,-
11,Balance,4.00%,-,-,-
12,Contrast,3.00%,-,-,-
13,Emphasis,3.00%,-,-,-
14,Movement,3.00%,-,-,-
15,Rhythm,2.00%,-,-,-
16,Variety,2.00%,-,-,-
17,Proportion,3.00%,-,-,-
18,Harmony,2.50%,-,-,-
19,Cohesiveness,2.50%,-,-,-
20,Pattern,1.00%,-,-,-
21,Brushwork,3.00%,-,-,-
22,Chiaroscuro,3.00%,-,-,-
23,Impasto,1.00%,-,-,-
24,Sfumato,1.00%,-,-,-
25,Glazing,1.00%,-,-,-
26,Scumbling,1.00%,-,-,-
27,Pointillism,1.00%,-,-,-
28,Wet-on-Wet,3.00%,-,-,-
29,Uniqueness,5.00%,-,-,-
30,Creativity,3.00%,-,-,-
31,Mood,3.00%,-,-,-
32,Viewer Engagement,3.00%,-,-,-
33,Emotional Resonance,4.00%,-,-,-

## **Questions Table Initialization**
Question#,Factor,Question,Score
1,Line,Does the artwork use line weight variation to enhance composition?,-
2,Line,Do the lines effectively guide the viewer's eye?,-
3,Line,Are lines controlled and purposeful?,-
4,Line,Is the linework expressive or rhythmically engaging?,-
5,Line,Do the lines contribute to the emotional impact of the artwork?,-
6,Shape,Are the shapes clear intentional and well-integrated?,-
7,Shape,Do the shapes contribute to compositional balance?,-
8,Shape,Is there a variety of shapes to enhance visual interest?,-
9,Shape,Are geometric/organic shapes used purposefully to support the theme?,-
10,Shape,Do the shapes reinforce movement or focal points?,-
11,Form,Is there a strong illusion of three-dimensionality where intended?,-
12,Form,Are the forms consistently proportioned?,-
13,Form,Is light and shadow effectively used to define form?,-
14,Form,Do forms interact naturally within space?,-
15,Form,Is form used expressively to enhance mood?,-
16,Space,Does the artwork effectively use perspective techniques to create depth?,-
17,Space,Is there a clear distinction between foreground middle ground and background elements?,-
18,Space,Is the arrangement of positive and negative space balanced in a way that enhances composition?,-
19,Space,Does the spatial arrangement guide the viewer's eye smoothly through the artwork?,-
20,Space,Does the use of space contribute to the emotional impact or storytelling of the piece?,-
21,Color,Are colors chosen harmoniously to enhance mood and impact?,-
22,Color,Does the use of color create depth or emphasis where needed?,-
23,Color,Are color contrasts used effectively?,-
24,Color,Is there a distinct and intentional color palette?,-
25,Color,Do color transitions contribute to the unity of the composition?,-
26,Texture,Is there a clear sense of texture within the artwork?,-
27,Texture,Does the texture enhance the realism or abstraction of the piece?,-
28,Texture,Are variations in texture used effectively?,-
29,Texture,Does the texture contribute to the emotional or sensory impact?,-
30,Texture,Is the application of texture intentional and controlled?,-
31,Tone/Value,Is there a full range of tonal values present?,-
32,Tone/Value,Does contrast effectively define form and depth?,-
33,Tone/Value,Are tonal gradations smooth and intentional?,-
34,Tone/Value,Does the use of tone contribute to the mood?,-
35,Tone/Value,Is the lighting effectively managed to enhance depth?,-
36,Saturation,Are colors appropriately saturated for the intended effect?,-
37,Saturation,Does desaturation or high saturation enhance emphasis?,-
38,Saturation,Are transitions between saturation levels smooth?,-
39,Saturation,Is saturation used to guide the eye?,-
40,Saturation,Does the level of saturation match the emotional tone?,-
41,Composition,Is the composition balanced and harmonious?,-
42,Composition,Does the composition effectively guide the viewer's eye?,-
43,Composition,Are focal points well-placed within the composition?,-
44,Composition,Do compositional elements contribute to unity and coherence?,-
45,Composition,Does the composition enhance the overall impact of the artwork?,-
46,Volume,Is volume effectively conveyed through shading or perspective?,-
47,Volume,Do objects appear three-dimensional where intended?,-
48,Volume,Are volumetric relationships between elements consistent?,-
49,Volume,Does volume contribute to the sense of realism or abstraction?,-
50,Volume,Is the illusion of depth achieved through careful control of volume?,-
51,Balance,Is visual balance effectively maintained?,-
52,Balance,Do elements have a stable distribution across the composition?,-
53,Balance,Are symmetrical or asymmetrical balances used intentionally?,-
54,Balance,Does balance contribute to the overall harmony of the piece?,-
55,Balance,Are contrasts in balance used for dramatic effect?,-
56,Contrast,Are differences in tone color or form used effectively?,-
57,Contrast,Does contrast create emphasis on focal points?,-

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4-turbo",
                messages: [
                    { role: "system", content: "You are an expert art critic. Analyze the given image. When instructed to export CSV data, format it precisely within ```csv code blocks. For the Factors Table, include ALL 33 factors. For the Questions Table, include ALL 165 questions with scores of 1 (Yes) or 0 (No). DO NOT calculate the Scores in the Factors Table - the backend will do this calculation." },
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
                        
                        // Function to handle CSV parsing with quotes
                        function parseCSVLine(line) {
                            const fields = [];
                            let inQuote = false;
                            let field = '';
                            
                            for (let i = 0; i < line.length; i++) {
                                const char = line[i];
                                
                                if (char === '"') {
                                    // Toggle the in-quote flag
                                    inQuote = !inQuote;
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