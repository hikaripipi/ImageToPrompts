/**
 * Advanced Metadata Extractor for NovelAI Images
 * This file contains advanced functions for extracting metadata from images
 * when the basic Drive API approach is insufficient.
 */

/**
 * Extract PNG metadata chunks (tEXt, iTXt, zTXt)
 * This can capture NovelAI metadata stored in PNG chunks
 */
function extractPNGMetadata(blob) {
  const metadata = {};

  try {
    const bytes = blob.getBytes();

    // Verify PNG signature
    if (
      bytes.length < 8 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      return metadata;
    }

    let offset = 8; // Skip PNG signature

    while (offset < bytes.length - 8) {
      // Read chunk length (4 bytes, big-endian)
      const length =
        (bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3];

      // Read chunk type (4 bytes)
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );

      // Check for text chunks that might contain NovelAI data
      if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
        const chunkData = extractTextChunk(bytes, offset + 8, length, type);
        if (chunkData.key && chunkData.value) {
          metadata[chunkData.key] = chunkData.value;

          // Try to parse as JSON if it looks like NovelAI metadata
          if (
            chunkData.key.toLowerCase().includes("comment") ||
            chunkData.key.toLowerCase().includes("parameters") ||
            chunkData.key.toLowerCase().includes("description")
          ) {
            try {
              const parsed = JSON.parse(chunkData.value);
              metadata.parsed_json = parsed;
            } catch (e) {
              // Not JSON, keep as text
            }
          }
        }
      }

      // Move to next chunk
      offset += 8 + length + 4; // header + data + CRC

      // Safety check to prevent infinite loops
      if (length > bytes.length || offset >= bytes.length) {
        break;
      }
    }
  } catch (error) {
    console.error("PNG metadata extraction error:", error);
  }

  return metadata;
}

/**
 * Extract text from PNG text chunks
 */
function extractTextChunk(bytes, offset, length, type) {
  const result = { key: "", value: "" };

  try {
    if (type === "tEXt") {
      // tEXt: keyword\0text
      let nullPos = -1;
      for (let i = offset; i < offset + length; i++) {
        if (bytes[i] === 0) {
          nullPos = i;
          break;
        }
      }

      if (nullPos > offset) {
        result.key = bytesToString(bytes, offset, nullPos - offset);
        result.value = bytesToString(
          bytes,
          nullPos + 1,
          offset + length - nullPos - 1
        );
      }
    } else if (type === "iTXt") {
      // iTXt: keyword\0compression\0language\0translated_keyword\0text
      let pos = offset;
      const parts = [];

      for (let part = 0; part < 5 && pos < offset + length; part++) {
        let start = pos;
        while (pos < offset + length && bytes[pos] !== 0) {
          pos++;
        }
        parts.push(bytesToString(bytes, start, pos - start));
        pos++; // Skip null terminator
      }

      if (parts.length >= 5) {
        result.key = parts[0];
        result.value = parts[4];
      }
    }
    // zTXt handling would require decompression, skip for now
  } catch (error) {
    console.error("Text chunk extraction error:", error);
  }

  return result;
}

/**
 * Convert bytes to string (UTF-8)
 */
function bytesToString(bytes, offset, length) {
  const slice = bytes.slice(offset, offset + length);
  return Utilities.newBlob(slice).getDataAsString("UTF-8");
}

/**
 * Enhanced NovelAI metadata extraction using PNG chunks
 */
function extractEnhancedNovelAIMetadata(file) {
  const metadata = {
    extraction_method: "enhanced_drive_api",
  };

  try {
    const driveFile = DriveApp.getFileById(file.id);
    const blob = driveFile.getBlob();

    // First, try basic Drive API metadata
    const basicMetadata = extractBasicMetadata(driveFile);
    Object.assign(metadata, basicMetadata);

    // Then try PNG chunk extraction
    if (file.name.toLowerCase().endsWith(".png")) {
      const pngMetadata = extractPNGMetadata(blob);

      // Process PNG metadata
      for (const [key, value] of Object.entries(pngMetadata)) {
        if (key === "parsed_json") {
          // Handle parsed JSON metadata
          const json = value;
          metadata.base_prompt = extractPrompt(json);
          metadata.uc = extractNegativePrompt(json);
          metadata.image_w = json.width || "";
          metadata.image_h = json.height || "";
          metadata.model = extractModel(json);
          metadata.extraction_method = "png_chunk_json";

          // Extract character prompts if available
          extractCharacterPrompts(json, metadata);
        } else if (
          key.toLowerCase().includes("comment") ||
          key.toLowerCase().includes("parameters")
        ) {
          // Try to parse text metadata
          try {
            const parsed = JSON.parse(value);
            metadata.base_prompt = extractPrompt(parsed);
            metadata.uc = extractNegativePrompt(parsed);
            metadata.extraction_method = "png_chunk_text_json";
          } catch (e) {
            // Plain text metadata
            metadata.base_prompt = value;
            metadata.extraction_method = "png_chunk_text";
          }
        }
      }
    }

    // UUID detection
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;
    if (uuidPattern.test(file.name)) {
      metadata.extraction_method += "_uuid_detected";
      if (!metadata.model) {
        metadata.model = "NovelAI (UUID detected)";
      }
    }

    // Set defaults
    setDefaultValues(metadata);
  } catch (error) {
    console.error(
      `Enhanced metadata extraction failed for ${file.name}:`,
      error
    );
    metadata.extraction_method = "error";
    setDefaultValues(metadata);
  }

  return metadata;
}

/**
 * Extract basic metadata from Drive file
 */
function extractBasicMetadata(driveFile) {
  const metadata = {};

  try {
    // File description
    const description = driveFile.getDescription();
    if (description) {
      try {
        const parsed = JSON.parse(description);
        metadata.base_prompt = extractPrompt(parsed);
        metadata.uc = extractNegativePrompt(parsed);
        metadata.image_w = parsed.width || "";
        metadata.image_h = parsed.height || "";
        metadata.model = extractModel(parsed);
        metadata.extraction_method = "description_json";
      } catch (e) {
        if (
          description.includes("prompt:") ||
          description.includes("NovelAI")
        ) {
          metadata.base_prompt = description;
          metadata.extraction_method = "description_text";
        }
      }
    }

    // Custom properties
    const properties = driveFile.getProperties();
    if (properties && Object.keys(properties).length > 0) {
      for (const [key, value] of Object.entries(properties)) {
        if (key.toLowerCase().includes("prompt")) {
          metadata.base_prompt = value;
        } else if (
          key.toLowerCase().includes("negative") ||
          key.toLowerCase().includes("uc")
        ) {
          metadata.uc = value;
        } else if (key.toLowerCase().includes("model")) {
          metadata.model = value;
        }
      }
      if (metadata.base_prompt || metadata.uc || metadata.model) {
        metadata.extraction_method = "custom_properties";
      }
    }
  } catch (error) {
    console.error("Basic metadata extraction error:", error);
  }

  return metadata;
}

/**
 * Extract prompt from various JSON structures
 */
function extractPrompt(json) {
  if (!json) return "";

  // Try different possible locations
  const candidates = [
    json.prompt,
    json.base_prompt,
    json.v4_prompt?.caption?.base_caption,
    json.Comment?.prompt,
    json.Comment?.v4_prompt?.caption?.base_caption,
  ];

  return first(...candidates);
}

/**
 * Extract negative prompt from various JSON structures
 */
function extractNegativePrompt(json) {
  if (!json) return "";

  const candidates = [
    json.uc,
    json.negative_prompt,
    json.v4_negative_prompt?.caption?.base_caption,
    json.Comment?.uc,
    json.Comment?.v4_negative_prompt?.caption?.base_caption,
  ];

  return first(...candidates);
}

/**
 * Extract model information
 */
function extractModel(json) {
  if (!json) return "";

  const candidates = [
    json.model,
    json.sampler,
    json.Software,
    json.Source,
    json.Comment?.model,
    json.Comment?.sampler,
  ];

  const model = first(...candidates);
  if (model) return model;

  // Check version
  if (json.version || json.Comment?.version) {
    return `v${json.version || json.Comment.version}`;
  }

  return "";
}

/**
 * Extract character prompts from JSON
 */
function extractCharacterPrompts(json, metadata) {
  try {
    const charCaptions =
      json.v4_prompt?.caption?.char_captions ||
      json.Comment?.v4_prompt?.caption?.char_captions ||
      [];
    const negCharCaptions =
      json.v4_negative_prompt?.caption?.char_captions ||
      json.Comment?.v4_negative_prompt?.caption?.char_captions ||
      [];

    for (let i = 0; i < 6; i++) {
      const charPrompt =
        i < charCaptions.length ? charCaptions[i].char_caption : "";
      const charUC =
        i < negCharCaptions.length ? negCharCaptions[i].char_caption : "";

      metadata[`char${i + 1}_prompt`] = charPrompt || "";
      metadata[`char${i + 1}_uc`] = charUC || "";
    }
  } catch (error) {
    console.error("Character prompt extraction error:", error);
    // Initialize empty character prompts
    for (let i = 1; i <= 6; i++) {
      metadata[`char${i}_prompt`] = "";
      metadata[`char${i}_uc`] = "";
    }
  }
}

/**
 * Set default values for metadata
 */
function setDefaultValues(metadata) {
  if (!metadata.image_w) metadata.image_w = "";
  if (!metadata.image_h) metadata.image_h = "";
  if (!metadata.model) metadata.model = "";
  if (!metadata.base_prompt) metadata.base_prompt = "";
  if (!metadata.uc) metadata.uc = "";

  // Initialize character prompts if not already set
  for (let i = 1; i <= 6; i++) {
    if (!metadata[`char${i}_prompt`]) metadata[`char${i}_prompt`] = "";
    if (!metadata[`char${i}_uc`]) metadata[`char${i}_uc`] = "";
  }
}

/**
 * Batch process files with enhanced metadata extraction
 */
function processEnhancedBatch(sheet, files, startIndex) {
  const rows = [];

  files.forEach((file, i) => {
    const rowIndex = startIndex + i + 2;
    const metadata = extractEnhancedNovelAIMetadata(file);

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
 * Advanced Metadata Extractor
 * Additional utilities and advanced extraction methods
 */

/**
 * Parse NovelAI metadata from various formats
 */
function parseNovelAIMetadata(text) {
  const metadata = {
    prompt: "",
    uc: "",
    width: "",
    height: "",
    model: "",
    sampler: "",
    steps: "",
    scale: "",
    seed: "",
    clipSkip: "",
    chars: [],
  };

  if (!text) return metadata;

  try {
    // Try JSON format first
    if (text.startsWith("{") || text.startsWith("[")) {
      const json = JSON.parse(text);
      return extractFromJSON(json);
    }

    // Try key-value format
    if (text.includes(":") || text.includes("=")) {
      return extractFromKeyValue(text);
    }

    // Try structured text format
    return extractFromStructuredText(text);
  } catch (error) {
    console.error("Failed to parse metadata:", error);
    // Return text as prompt if parsing fails
    metadata.prompt = text;
    return metadata;
  }
}

/**
 * Extract metadata from JSON format
 */
function extractFromJSON(json) {
  const metadata = {
    prompt: json.prompt || json.positive_prompt || json.description || "",
    uc: json.uc || json.negative_prompt || json.neg_prompt || "",
    width: json.width || json.w || json.image_w || "",
    height: json.height || json.h || json.image_h || "",
    model: json.model || json.model_name || "",
    sampler: json.sampler || json.sampler_name || "",
    steps: json.steps || json.num_steps || "",
    scale: json.scale || json.cfg_scale || json.guidance_scale || "",
    seed: json.seed || json.random_seed || "",
    clipSkip: json.clip_skip || json.clipskip || "",
    chars: [],
  };

  // Extract character prompts
  for (let i = 1; i <= 6; i++) {
    const char = {
      prompt: json[`char${i}_prompt`] || json[`character${i}_prompt`] || "",
      uc: json[`char${i}_uc`] || json[`character${i}_uc`] || "",
    };

    if (char.prompt || char.uc) {
      metadata.chars.push(char);
    }
  }

  // Handle nested structures
  if (json.metadata) {
    return extractFromJSON({ ...json.metadata, ...json });
  }

  return metadata;
}

/**
 * Extract metadata from key-value format
 */
function extractFromKeyValue(text) {
  const metadata = {
    prompt: "",
    uc: "",
    width: "",
    height: "",
    model: "",
    sampler: "",
    steps: "",
    scale: "",
    seed: "",
    clipSkip: "",
    chars: [],
  };

  const lines = text.split(/[\n\r]+/);
  const keyMap = {
    prompt: ["prompt", "positive", "description"],
    uc: ["uc", "negative", "neg", "negative_prompt"],
    width: ["width", "w", "image_w"],
    height: ["height", "h", "image_h"],
    model: ["model", "model_name"],
    sampler: ["sampler", "sampler_name"],
    steps: ["steps", "num_steps"],
    scale: ["scale", "cfg", "cfg_scale", "guidance"],
    seed: ["seed", "random_seed"],
    clipSkip: ["clip_skip", "clipskip"],
  };

  lines.forEach((line) => {
    const match = line.match(/^([^:=]+)[:=](.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();

      // Check against key mappings
      for (const [field, aliases] of Object.entries(keyMap)) {
        if (aliases.some((alias) => key.includes(alias))) {
          metadata[field] = value;
          break;
        }
      }

      // Check for character prompts
      const charMatch = key.match(/char(?:acter)?(\d+)_(prompt|uc)/i);
      if (charMatch) {
        const charIndex = parseInt(charMatch[1]) - 1;
        const field = charMatch[2].toLowerCase() === "uc" ? "uc" : "prompt";

        if (!metadata.chars[charIndex]) {
          metadata.chars[charIndex] = { prompt: "", uc: "" };
        }
        metadata.chars[charIndex][field] = value;
      }
    }
  });

  return metadata;
}

/**
 * Extract metadata from structured text
 */
function extractFromStructuredText(text) {
  const metadata = {
    prompt: "",
    uc: "",
    width: "",
    height: "",
    model: "",
    sampler: "",
    steps: "",
    scale: "",
    seed: "",
    clipSkip: "",
    chars: [],
  };

  // Common patterns in NovelAI exports
  const patterns = {
    prompt: /(?:prompt|positive):\s*(.+?)(?=\n|$)/i,
    uc: /(?:uc|negative|neg):\s*(.+?)(?=\n|$)/i,
    dimensions: /(\d+)\s*x\s*(\d+)/,
    model: /(?:model|using):\s*(.+?)(?=\n|$)/i,
    sampler: /(?:sampler):\s*(.+?)(?=\n|$)/i,
    steps: /(?:steps):\s*(\d+)/i,
    scale: /(?:scale|cfg):\s*([\d.]+)/i,
    seed: /(?:seed):\s*(\d+)/i,
  };

  // Extract using patterns
  for (const [field, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) {
      if (field === "dimensions") {
        metadata.width = match[1];
        metadata.height = match[2];
      } else {
        metadata[field] = match[1];
      }
    }
  }

  // If no structured format found, treat as prompt
  if (!metadata.prompt && !metadata.uc) {
    metadata.prompt = text.trim();
  }

  return metadata;
}

/**
 * Format metadata for display
 */
function formatMetadataForSheet(metadata) {
  const formatted = {
    imageName: metadata.imageName || "",
    driveLink: metadata.driveLink || "",
    imageW: String(metadata.imageW || metadata.width || ""),
    imageH: String(metadata.imageH || metadata.height || ""),
    model: metadata.model || "",
    basePrompt: metadata.basePrompt || metadata.prompt || "",
    uc: metadata.uc || metadata.negative || "",
    char1Prompt: "",
    char1UC: "",
    char2Prompt: "",
    char2UC: "",
    char3Prompt: "",
    char3UC: "",
    char4Prompt: "",
    char4UC: "",
    char5Prompt: "",
    char5UC: "",
    char6Prompt: "",
    char6UC: "",
  };

  // Add character data
  if (metadata.chars && Array.isArray(metadata.chars)) {
    metadata.chars.forEach((char, index) => {
      if (index < 6) {
        formatted[`char${index + 1}Prompt`] = char.prompt || "";
        formatted[`char${index + 1}UC`] = char.uc || "";
      }
    });
  }

  return formatted;
}

/**
 * Batch process images with progress tracking
 */
function batchProcessImages(sheet, files, options = {}) {
  const {
    batchSize = 10,
    startRow = 2,
    useCloudFunction = true,
    showProgress = true,
  } = options;

  const totalBatches = Math.ceil(files.length / batchSize);
  let processedCount = 0;
  let errorCount = 0;

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * batchSize;
    const endIdx = Math.min(startIdx + batchSize, files.length);
    const batch = files.slice(startIdx, endIdx);

    batch.forEach((file, i) => {
      try {
        const row = startRow + startIdx + i;
        let metadata;

        if (useCloudFunction && isCloudFunctionConfigured()) {
          metadata = extractEnhancedMetadata(file);
        } else {
          metadata = extractMetadataFromFile(file);
        }

        writeMetadataToSheet(sheet, metadata, row);
        processedCount++;
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        errorCount++;
      }
    });

    // Show progress
    if (showProgress && batchIndex % 5 === 0) {
      const progress = Math.round((endIdx / files.length) * 100);
      console.log(`Progress: ${progress}% (${endIdx}/${files.length} files)`);
    }

    // Rate limiting
    if (batchIndex < totalBatches - 1) {
      Utilities.sleep(100);
    }
  }

  return {
    processed: processedCount,
    errors: errorCount,
    total: files.length,
  };
}

/**
 * Export metadata to CSV format
 */
function exportMetadataToCSV() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  if (values.length <= 1) {
    SpreadsheetApp.getUi().alert("No data to export");
    return;
  }

  // Convert to CSV
  const csv = values
    .map((row) => {
      return row
        .map((cell) => {
          // Escape quotes and wrap in quotes if contains comma
          const value = String(cell);
          if (
            value.includes(",") ||
            value.includes('"') ||
            value.includes("\n")
          ) {
            return '"' + value.replace(/"/g, '""') + '"';
          }
          return value;
        })
        .join(",");
    })
    .join("\n");

  // Create file
  const blob = Utilities.newBlob(csv, "text/csv", "metadata_export.csv");
  const file = DriveApp.createFile(blob);

  // Show download link
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    "Export Complete",
    `CSV file created: ${file.getName()}\n\nDownload URL:\n${file.getUrl()}`,
    ui.ButtonSet.OK
  );
}

/**
 * Import metadata from CSV
 */
function importMetadataFromCSV() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Import CSV",
    "Enter the Google Drive URL of the CSV file:",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const fileUrl = response.getResponseText().trim();
  const fileId = extractFolderId(fileUrl);

  if (!fileId) {
    ui.alert("Invalid file URL");
    return;
  }

  try {
    const file = DriveApp.getFileById(fileId);
    const csvData = file.getBlob().getDataAsString();
    const rows = Utilities.parseCsv(csvData);

    if (rows.length === 0) {
      ui.alert("CSV file is empty");
      return;
    }

    // Clear existing data
    clearDataOnly();

    // Import data (skip header row)
    const sheet = SpreadsheetApp.getActiveSheet();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length >= 3) {
        // Minimum required columns
        sheet.getRange(i + 1, 1).insertCheckboxes();
        sheet.getRange(i + 1, 3, 1, row.length - 2).setValues([row.slice(2)]);
      }
    }

    ui.alert(`✅ Imported ${rows.length - 1} rows successfully!`);
  } catch (error) {
    ui.alert(`❌ Import failed: ${error.toString()}`);
  }
}
