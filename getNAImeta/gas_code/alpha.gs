/**
 * Alpha Channel Extraction Solutions for GAS
 * Multiple approaches to extract NovelAI stealth metadata
 */

/**
 * Method 1: Use external Python service (Cloud Functions/Cloud Run)
 * This is the most reliable approach for alpha channel extraction
 */
function extractAlphaChannelViaAPI(file) {
  const metadata = {};

  try {
    const driveFile = DriveApp.getFileById(file.id);
    const blob = driveFile.getBlob();

    // Check if it's a PNG file (remove UUID restriction)
    if (blob.getContentType() !== "image/png") {
      return metadata; // Skip non-PNG files
    }

    // Cloud Function URL - will be updated after deployment
    const cloudFunctionUrl =
      "https://us-central1-novelai-metadata-extractor.cloudfunctions.net/extract-novelai-metadata";

    const payload = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      payload: JSON.stringify({
        image_data: Utilities.base64Encode(blob.getBytes()),
        filename: file.name,
      }),
    };

    const response = UrlFetchApp.fetch(cloudFunctionUrl, payload);

    if (response.getResponseCode() === 200) {
      const result = JSON.parse(response.getContentText());
      if (result.success && result.metadata) {
        metadata.base_prompt = result.metadata.prompt || "";
        metadata.uc = result.metadata.uc || "";
        metadata.image_w = result.metadata.width || "";
        metadata.image_h = result.metadata.height || "";
        metadata.model = result.metadata.model || "";
        metadata.extraction_method = "alpha_channel_api";

        // Extract character prompts
        if (result.metadata.char_captions) {
          for (let i = 0; i < 6; i++) {
            const charData = result.metadata.char_captions[i];
            metadata[`char${i + 1}_prompt`] = charData?.char_caption || "";
            metadata[`char${i + 1}_uc`] = charData?.char_uc || "";
          }
        }
      }
    }
  } catch (error) {
    console.error(
      `Alpha channel API extraction failed for ${file.name}:`,
      error
    );
    metadata.extraction_method = "alpha_api_error";
  }

  return metadata;
}

/**
 * Method 2: Use Google Cloud Vision API for image analysis
 * Limited but can extract some text-based metadata
 */
function extractViaCloudVision(file) {
  const metadata = {};

  try {
    // Note: This requires enabling Cloud Vision API and setting up authentication
    const apiKey = "YOUR_CLOUD_VISION_API_KEY"; // Replace with your API key
    const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    const driveFile = DriveApp.getFileById(file.id);
    const blob = driveFile.getBlob();
    const base64Image = Utilities.base64Encode(blob.getBytes());

    const payload = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      payload: JSON.stringify({
        requests: [
          {
            image: {
              content: base64Image,
            },
            features: [
              { type: "TEXT_DETECTION", maxResults: 10 },
              { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 },
            ],
          },
        ],
      }),
    };

    const response = UrlFetchApp.fetch(visionUrl, payload);
    const result = JSON.parse(response.getContentText());

    if (result.responses && result.responses[0].textAnnotations) {
      const detectedText = result.responses[0].textAnnotations[0].description;

      // Try to parse detected text as JSON (if it contains metadata)
      try {
        const parsed = JSON.parse(detectedText);
        metadata.base_prompt = parsed.prompt || "";
        metadata.uc = parsed.uc || "";
        metadata.extraction_method = "cloud_vision_ocr";
      } catch (e) {
        // Not JSON, but might contain useful text
        if (
          detectedText.includes("prompt") ||
          detectedText.includes("NovelAI")
        ) {
          metadata.base_prompt = detectedText;
          metadata.extraction_method = "cloud_vision_text";
        }
      }
    }
  } catch (error) {
    console.error(`Cloud Vision extraction failed for ${file.name}:`, error);
  }

  return metadata;
}

/**
 * Method 3: Manual LSB extraction attempt in GAS (limited success)
 * This is a simplified version that might work for some cases
 */
function attemptManualLSBExtraction(file) {
  const metadata = {};

  try {
    const driveFile = DriveApp.getFileById(file.id);
    const blob = driveFile.getBlob();
    const bytes = blob.getBytes();

    // Check if it's a PNG file
    if (
      bytes.length < 8 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      return metadata;
    }

    // Look for stealth signature in the file
    const stealth_signature = "stealth_pngcomp";
    const signatureBytes = [];
    for (let i = 0; i < stealth_signature.length; i++) {
      signatureBytes.push(stealth_signature.charCodeAt(i));
    }

    // Search for the signature in the file
    let foundSignature = false;
    let signaturePos = -1;

    for (let i = 0; i < bytes.length - signatureBytes.length; i++) {
      let match = true;
      for (let j = 0; j < signatureBytes.length; j++) {
        if (bytes[i + j] !== signatureBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        foundSignature = true;
        signaturePos = i;
        break;
      }
    }

    if (foundSignature) {
      metadata.extraction_method = "stealth_signature_found";
      // Note: Full LSB extraction would require complex bit manipulation
      // This is just detecting the presence of stealth data
      metadata.model = "NovelAI (Stealth detected)";
    }
  } catch (error) {
    console.error(`Manual LSB extraction failed for ${file.name}:`, error);
  }

  return metadata;
}

/**
 * Method 4: Hybrid approach - try multiple methods
 */
function extractAlphaChannelHybrid(file) {
  let metadata = {};

  // Try API method first (most reliable)
  try {
    metadata = extractAlphaChannelViaAPI(file);
    if (metadata.base_prompt) {
      return metadata;
    }
  } catch (e) {
    console.log("API method failed, trying alternatives");
  }

  // Try Cloud Vision as backup
  try {
    const visionMetadata = extractViaCloudVision(file);
    if (visionMetadata.base_prompt) {
      Object.assign(metadata, visionMetadata);
      return metadata;
    }
  } catch (e) {
    console.log("Cloud Vision method failed");
  }

  // Try manual detection as last resort
  try {
    const manualMetadata = attemptManualLSBExtraction(file);
    Object.assign(metadata, manualMetadata);
  } catch (e) {
    console.log("Manual method failed");
  }

  return metadata;
}

/**
 * Enhanced batch processing with alpha channel extraction
 */
function processEnhancedBatchWithAlpha(sheet, files, startIndex) {
  const rows = [];

  files.forEach((file, i) => {
    const rowIndex = startIndex + i + 2;

    // Try enhanced metadata extraction first
    let metadata = extractEnhancedNovelAIMetadata(file);

    // If no prompt found, try alpha channel extraction for PNG files
    if (!metadata.base_prompt) {
      const alphaMetadata = extractAlphaChannelHybrid(file);

      // Merge alpha channel results
      if (alphaMetadata.base_prompt) {
        Object.assign(metadata, alphaMetadata);
      }
    }

    const row = [
      false, // Checkbox (A列)
      startIndex + i + 1, // Index (B列)
      "", // Thumbnail (C列)
      file.name, // Filename (D列)
      file.url, // Drive URL (E列)
      metadata.image_w || "", // image_w (F列)
      metadata.image_h || "", // image_h (G列)
      metadata.model || "", // model (H列)
      metadata.base_prompt || "", // base_prompt (I列)
      metadata.uc || "", // UC (J列)
    ];

    // Add character prompts (K列以降)
    for (let j = 1; j <= 6; j++) {
      row.push(metadata[`char${j}_prompt`] || "");
      row.push(metadata[`char${j}_uc`] || "");
    }

    rows.push(row);

    // Create thumbnail
    try {
      createOptimizedThumbnail(sheet, file, rowIndex);
    } catch (error) {
      console.error(`Thumbnail creation failed for ${file.name}:`, error);
    }
  });

  if (rows.length > 0) {
    const startRow = startIndex + 2;
    sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

    // Add checkboxes to column A
    sheet.getRange(startRow, 1, rows.length, 1).insertCheckboxes();
  }
}

/**
 * Update the main processing function to use alpha channel extraction
 */
function refreshImageIndexWithAlpha() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const folderUrl = String(sheet.getRange("B1").getValue()).trim();
  if (!folderUrl) {
    return SpreadsheetApp.getUi().alert(
      "Cell B1 is empty – paste a Drive *folder* link."
    );
  }

  const folderId = extractFolderId(folderUrl);
  if (!folderId) {
    return SpreadsheetApp.getUi().alert(
      "The link in B1 doesn't look like a Drive folder."
    );
  }

  SpreadsheetApp.getUi().alert(
    "🔍 Scanning folder with alpha channel extraction..."
  );

  const files = [];
  walkFolder(folderId, files);

  if (files.length === 0) {
    return SpreadsheetApp.getUi().alert("No image files found in the folder.");
  }

  clearPreviousData(sheet);
  setupHeaders(sheet);

  const batchSize = 5; // Smaller batch for API calls
  const totalBatches = Math.ceil(files.length / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * batchSize;
    const endIdx = Math.min(startIdx + batchSize, files.length);
    const batch = files.slice(startIdx, endIdx);

    processEnhancedBatchWithAlpha(sheet, batch, startIdx);

    console.log(`Processed alpha batch ${batchIndex + 1}/${totalBatches}`);

    // Longer pause for API rate limits
    if (batchIndex < totalBatches - 1) {
      Utilities.sleep(500);
    }
  }

  if (files.length > 0) {
    sheet.setRowHeights(2, files.length, 100);
  }

  SpreadsheetApp.getUi().alert(
    `✅ Processed ${files.length} images with alpha channel extraction!`
  );
}

/**
 * Alpha Channel Metadata Extractor
 * Handles Cloud Function integration for extracting metadata from PNG alpha channel
 */

// Cloud Function configuration
const CLOUD_FUNCTION_CONFIG = {
  url: "https://us-central1-novelai-metadata-extractor.cloudfunctions.net/extract-novelai-metadata",
  timeout: 30000, // 30 seconds
  maxRetries: 3,
};

/**
 * Extract metadata using Cloud Function (with alpha channel support)
 */
function extractMetadataWithCloudFunction(fileId) {
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();

  // Check if it's a PNG file
  if (blob.getContentType() !== "image/png") {
    console.log("Not a PNG file, skipping alpha channel extraction");
    return null;
  }

  try {
    // Convert blob to base64
    const base64Data = Utilities.base64Encode(blob.getBytes());

    // Prepare request payload
    const payload = {
      image_data: base64Data,
      filename: file.getName(),
      extract_alpha: true,
    };

    // Make request to Cloud Function
    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeout: CLOUD_FUNCTION_CONFIG.timeout,
    };

    let response = null;
    let lastError = null;

    // Retry logic
    for (
      let attempt = 1;
      attempt <= CLOUD_FUNCTION_CONFIG.maxRetries;
      attempt++
    ) {
      try {
        response = UrlFetchApp.fetch(CLOUD_FUNCTION_CONFIG.url, options);

        if (response.getResponseCode() === 200) {
          break; // Success
        } else if (response.getResponseCode() === 429) {
          // Rate limited, wait before retry
          Utilities.sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
        } else {
          lastError = `HTTP ${response.getResponseCode()}: ${response.getContentText()}`;
        }
      } catch (error) {
        lastError = error.toString();
        console.error(`Attempt ${attempt} failed:`, lastError);

        if (attempt < CLOUD_FUNCTION_CONFIG.maxRetries) {
          Utilities.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    if (!response || response.getResponseCode() !== 200) {
      throw new Error(lastError || "Failed to connect to Cloud Function");
    }

    // Parse response
    const result = JSON.parse(response.getContentText());

    if (result.error) {
      throw new Error(result.error);
    }

    return result.metadata;
  } catch (error) {
    console.error("Cloud Function error:", error);
    return null;
  }
}

/**
 * Enhanced metadata extraction with fallback
 */
function extractEnhancedMetadata(file) {
  // First try basic extraction
  const basicMetadata = extractMetadataFromFile(file);

  // If Cloud Function is configured, try alpha channel extraction
  if (
    CLOUD_FUNCTION_CONFIG.url &&
    CLOUD_FUNCTION_CONFIG.url !== "YOUR_CLOUD_FUNCTION_URL_PLACEHOLDER"
  ) {
    try {
      const alphaMetadata = extractMetadataWithCloudFunction(file.id);

      if (alphaMetadata) {
        // Merge alpha channel metadata with basic metadata
        return mergeMetadata(basicMetadata, alphaMetadata);
      }
    } catch (error) {
      console.error(
        "Alpha channel extraction failed, using basic metadata:",
        error
      );
    }
  }

  return basicMetadata;
}

/**
 * Merge metadata from different sources
 */
function mergeMetadata(basic, alpha) {
  const merged = { ...basic };

  // Alpha channel data takes precedence
  if (alpha) {
    merged.basePrompt = alpha.prompt || alpha.base_prompt || basic.basePrompt;
    merged.uc = alpha.uc || alpha.negative_prompt || basic.uc;
    merged.imageW = alpha.width || alpha.image_w || basic.imageW;
    merged.imageH = alpha.height || alpha.image_h || basic.imageH;
    merged.model = alpha.model || basic.model;

    // Character prompts
    for (let i = 1; i <= 6; i++) {
      merged[`char${i}Prompt`] =
        alpha[`char${i}_prompt`] || basic[`char${i}Prompt`];
      merged[`char${i}UC`] = alpha[`char${i}_uc`] || basic[`char${i}UC`];
    }

    // Additional metadata from alpha channel
    if (alpha.sampler) merged.sampler = alpha.sampler;
    if (alpha.steps) merged.steps = alpha.steps;
    if (alpha.scale) merged.scale = alpha.scale;
    if (alpha.seed) merged.seed = alpha.seed;
    if (alpha.clip_skip) merged.clipSkip = alpha.clip_skip;
  }

  return merged;
}

/**
 * Process batch with alpha channel support
 */
function processEnhancedBatchWithAlpha(sheet, files, startIndex) {
  const rows = [];

  files.forEach((file, i) => {
    const metadata = extractEnhancedMetadata(file);
    const rowIndex = startIndex + i + 2;

    // Write to sheet
    writeMetadataToSheet(sheet, metadata, rowIndex);

    // Log progress
    console.log(
      `Processed ${file.name} with${
        metadata.fromAlpha ? " alpha" : "out alpha"
      } channel`
    );
  });
}

/**
 * Check if Cloud Function is properly configured
 */
function isCloudFunctionConfigured() {
  return (
    CLOUD_FUNCTION_CONFIG.url &&
    CLOUD_FUNCTION_CONFIG.url !== "YOUR_CLOUD_FUNCTION_URL_PLACEHOLDER"
  );
}

/**
 * Test Cloud Function connection
 */
function testCloudFunction() {
  const ui = SpreadsheetApp.getUi();

  if (!isCloudFunctionConfigured()) {
    return ui.alert(
      "Cloud Function not configured. Please update CLOUD_FUNCTION_CONFIG.url"
    );
  }

  try {
    const response = UrlFetchApp.fetch(CLOUD_FUNCTION_CONFIG.url, {
      method: "get",
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() === 200) {
      ui.alert("✅ Cloud Function is working!");
    } else {
      ui.alert(
        `❌ Cloud Function returned status ${response.getResponseCode()}`
      );
    }
  } catch (error) {
    ui.alert(`❌ Failed to connect to Cloud Function:\n${error.toString()}`);
  }
}
