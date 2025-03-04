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

// CSV processing utility function
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
      // Use a placeholder - the important instructions are in the system message
      finalPrompt = `ExportCSV = ${exportCSV}\n\nUser-provided Artwork Title: "${artTitle}". ${artistInfo}\nThe prompt will handle where to place this information.`;
    }

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo",
        messages: [
          { 
            role: "system", 
            content: "You are an expert art critic with a discerning eye. When analyzing the artwork, be thorough and honest. For techniques that are completely absent from the artwork (like Pointillism, Impasto, etc. if they're not present), answer 'No' to all related questions. Analyze the given image with precision and careful attention to detail. When instructed to export CSV data, format it precisely within code blocks labeled as csv. For the Factors Table, include ALL 33 factors. For the Questions Table, include ALL 165 questions with honest scores of 1 (Yes) or 0 (No). DO NOT give all positive scores - be critical and truthful. DO NOT calculate the Scores in the Factors Table - the backend will do this calculation. Always begin your analysis with a heading 'Analysis of Skill Mastery'." 
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

    // Remove any userStyle tags from the response
    analysisText = analysisText.replace(/<userStyle>.*?<\/userStyle>/g, '');

    // Debugging Log: Show Full OpenAI Response
    console.log("🔍 Full AI Response Length:", analysisText.length);

    // Extract CSV Data (if enabled)
    let factorsCSV = "";
    let questionsCSV = "";
    let csvLinks = null;
    let smiValue = "0.0"; // Default SMI value

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
      // More robust CSV regex that captures various code block formats
      const csvRegex = /```(?:csv)?\s*([\s\S]+?)\s*```/g;
      let match;
      let csvFiles = 0;
      let matches = [];

      // Find all CSV code blocks
      while ((match = csvRegex.exec(analysisText)) !== null) {
        matches.push(match[0]); // Store the full match
        csvFiles++;
        
        // Check if this looks like a factors table (has "Factor" in first row)
        if (match[1].trim().startsWith("Factor#") || match[1].includes("Weight")) {
          factorsCSV = match[1].trim();
          console.log("Raw Factors CSV extracted:", factorsCSV.length, "characters");
        }
        // Check if this looks like a questions table
        else if (match[1].trim().startsWith("Question#") || match[1].includes("Question,Score")) {
          questionsCSV = match[1].trim();
          console.log("Raw Questions CSV extracted:", questionsCSV.length, "characters");
        }
      }
      
      // Verify if we extracted both CSV tables
      if (!factorsCSV || !questionsCSV) {
        console.log("⚠️ WARNING: Did not extract both CSV tables correctly from AI response.");
        console.log("Factors CSV found:", !!factorsCSV);
        console.log("Questions CSV found:", !!questionsCSV);
        console.log("Total CSV matches found:", matches.length);
        
        // If we found at least 2 matches but couldn't categorize them correctly
        if (matches.length >= 2 && (!factorsCSV || !questionsCSV)) {
          // Default: first match is factors, second is questions
          if (!factorsCSV && matches.length > 0) {
            const firstMatch = matches[0];
            const content = firstMatch.replace(/```(?:csv)?\s*([\s\S]+?)\s*```/g, '$1').trim();
            factorsCSV = content;
          }
          if (!questionsCSV && matches.length > 1) {
            const secondMatch = matches[1];
            const content = secondMatch.replace(/```(?:csv)?\s*([\s\S]+?)\s*```/g, '$1').trim();
            questionsCSV = content;
          }
        }
      }

      // Remove all CSV blocks from the analysis text
      analysisText = analysisText.replace(csvRegex, '').trim();

      // Process Questions CSV to calculate Factor scores if we have both CSVs
      if (questionsCSV && factorsCSV) {
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
                console.log(`Warning: Empty factor on line ${i+1}`);
                continue;
              }
              
              if (!factorScores[factor]) {
                factorScores[factor] = [];
              }
              
              factorScores[factor].push(score);
            } catch (err) {
              console.error(`Error parsing line ${i+1}:`, err.message);
            }
          }
          
          console.log("Extracted factors with scores:", Object.keys(factorScores).length);
          
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
                  
                  // Set BFB to "N/A" if score is 0, otherwise calculate it
                  let bfb = "N/A";
                  if (score > 0) {
                    bfb = (weight / score).toFixed(2);
                  }
                  
                  // Reconstruct the line with the calculated score
                  parts[3] = score; // Integer score
                  parts[4] = extend;
                  parts[5] = bfb;
                  updatedFactorsLines.push(parts.join(','));
                } else {
                  console.log(`Warning: No scores found for factor: ${factorName}`);
                  // Keep the original line but set score to 0
                  parts[3] = 0;
                  parts[4] = 0;
                  parts[5] = "N/A";
                  updatedFactorsLines.push(parts.join(','));
                }
              } catch (err) {
                console.error(`Error processing factor line ${i+1}:`, err.message);
              }
            }
            
            // Check how many factors we processed
            console.log(`Updated ${updatedFactorsLines.length - 1} factor lines`);
            
            // Update factorsCSV with the calculated scores
            factorsCSV = updatedFactorsLines.join('\n');
            
            // Calculate SMI by summing the Extend values
            let totalExtend = 0;
            let factorCount = 0;
            
            for (let i = 1; i < updatedFactorsLines.length; i++) {
              try {
                const line = updatedFactorsLines[i].trim();
                if (!line) continue;
                
                const parts = parseCSVLine(line);
                if (parts.length >= 5) {
                  const extend = parseFloat(parts[4]);
                  if (!isNaN(extend)) {
                    totalExtend += extend;
                    factorCount++;
                  }
                }
              } catch (err) {
                console.error(`Error calculating SMI for line ${i+1}:`, err.message);
              }
            }
            
            // Calculate the SMI and round to 1 decimal place
            smiValue = totalExtend.toFixed(1);
            console.log(`Calculated SMI: ${smiValue} from ${factorCount} factors`);
            
            // Replace SMI placeholder in the analysis text if it exists
            analysisText = analysisText.replace(/{{SMI}}/g, smiValue);
          }
        }
      }

      // Save CSV files
      try {
        const publicDir = path.join(__dirname, "public");
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir);
        }
        
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
      } catch (err) {
        console.error("Error saving CSV files:", err.message);
      }
    }

    // Final text cleanup
    // Ensure proper Markdown rendering by adding line breaks between sections
    analysisText = analysisText
      .replace(/^##\s+/gm, "\n## ") // Add empty line before headings
      .replace(/^###\s+/gm, "\n### ") // Add empty line before subheadings
      .replace(/\n\n\n+/g, "\n\n") // Remove excessive line breaks
      .replace(/<userStyle>.*?<\/userStyle>/g, ''); // Remove any remaining userStyle tags

    // Make sure analysis has a title if needed
    if (!analysisText.includes("# Analysis") && !analysisText.includes("## Analysis")) {
      analysisText = "# Analysis of Skill Mastery\n\n" + analysisText;
    }

    const finalResponse = {
      analysis: analysisText,
      csvLinks: csvLinks,
      imageUrl: imageUrl,
      smi: smiValue // Include the calculated SMI value in the response
    };

    // Send the response
    res.json(finalResponse);

  } catch (error) {
    console.error("🔴 OpenAI API Error:", error.message);
    if (error.response) {
      console.error("Error response data:", error.response.data);
    }
    res.status(500).json({ error: error.message || "OpenAI request failed" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));