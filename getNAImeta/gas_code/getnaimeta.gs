/**
 * NovelAI Metadata Extractor for Google Sheets
 * Gets metadata from images in Google Drive folder
 * URL input: Cell C1
 * Data starts from row 2 (row 1 is fixed header)
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Hikaribot")
    .addItem("Get Metadata", "getMetadata")
    .addItem("test(get1img meta)", "testGetSingleImageMetadata")
    .addSeparator()
    .addItem("Clear Data (Keep Header)", "clearDataOnly")
    .addItem("Delete Selected Images", "deleteSelectedImages")
    .addToUi();
}

/**
 * Main function to get metadata from all images in folder
 */
function getMetadata() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const folderUrl = String(sheet.getRange("C1").getValue()).trim();

  if (!folderUrl) {
    return SpreadsheetApp.getUi().alert(
      "Cell C1 is empty – paste a Drive folder URL."
    );
  }

  const folderId = extractFolderId(folderUrl);
  if (!folderId) {
    return SpreadsheetApp.getUi().alert(
      "The URL in C1 doesn't look like a Drive folder."
    );
  }

  // Collect all image files
  const files = [];
  try {
    walkFolder(folderId, files);
  } catch (error) {
    return SpreadsheetApp.getUi().alert(
      `Error accessing folder: ${error.message}`
    );
  }

  if (files.length === 0) {
    return SpreadsheetApp.getUi().alert("No image files found in the folder.");
  }

  // Clear existing data (but keep header)
  clearDataOnly();

  // Process files
  const ui = SpreadsheetApp.getUi();
  ui.alert(`Found ${files.length} images. Processing...`);

  let successCount = 0;
  let errorCount = 0;

  files.forEach((file, index) => {
    try {
      const metadata = extractMetadataFromFile(file);
      writeMetadataToSheet(sheet, metadata, index + 2); // Start from row 2
      successCount++;

      // Brief pause every 10 files to avoid rate limits
      if ((index + 1) % 10 === 0) {
        Utilities.sleep(100);
      }
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error);
      errorCount++;
    }
  });

  ui.alert(
    `✅ Complete!\n\nProcessed: ${successCount} images\nErrors: ${errorCount}`
  );
}

/**
 * Test function to get metadata from a single image
 */
function testGetSingleImageMetadata() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  // Prompt for image URL
  const response = ui.prompt(
    "Test Single Image",
    "Enter the Google Drive URL of an image:",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const imageUrl = response.getResponseText().trim();
  if (!imageUrl) {
    return ui.alert("No URL provided.");
  }

  const fileId = extractFolderId(imageUrl); // Works for both folder and file IDs
  if (!fileId) {
    return ui.alert("Invalid Google Drive URL.");
  }

  try {
    const file = DriveApp.getFileById(fileId);
    const metadata = extractMetadataFromFile({
      id: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      mimeType: file.getMimeType(),
    });

    // Find next empty row
    const lastRow = sheet.getLastRow();
    const nextRow = lastRow + 1;

    writeMetadataToSheet(sheet, metadata, nextRow);

    ui.alert(
      `✅ Metadata extracted!\n\nFile: ${file.getName()}\nAdded to row: ${nextRow}`
    );
  } catch (error) {
    ui.alert(`❌ Error: ${error.message}`);
  }
}

/**
 * Clear data rows but keep the header
 */
function clearDataOnly() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    // Clear content from row 2 to last row
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();

    // Clear checkboxes in column A
    const checkboxRange = sheet.getRange(2, 1, lastRow - 1, 1);
    checkboxRange.removeCheckboxes();
  }
}

/**
 * Delete images that are checked in column A
 */
function deleteSelectedImages() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return ui.alert("No data to process.");
  }

  // Get all checkbox values and file URLs
  const checkboxValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const fileUrls = sheet.getRange(2, 5, lastRow - 1, 1).getValues(); // Column E (Drive link)

  const filesToDelete = [];
  const rowsToDelete = [];

  for (let i = 0; i < checkboxValues.length; i++) {
    if (checkboxValues[i][0] === true) {
      filesToDelete.push(fileUrls[i][0]);
      rowsToDelete.push(i + 2); // Row number (1-indexed)
    }
  }

  if (filesToDelete.length === 0) {
    return ui.alert("No images selected for deletion.");
  }

  // Confirm deletion
  const response = ui.alert(
    "Confirm Deletion",
    `Delete ${filesToDelete.length} selected images from Google Drive?\n\nThis action cannot be undone.`,
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return;
  }

  // Delete files from Drive
  let deletedCount = 0;
  let errorCount = 0;

  filesToDelete.forEach((url) => {
    try {
      const fileId = extractFolderId(url);
      if (fileId) {
        DriveApp.getFileById(fileId).setTrashed(true);
        deletedCount++;
      }
    } catch (error) {
      console.error(`Error deleting file: ${error}`);
      errorCount++;
    }
  });

  // Remove rows from sheet (in reverse order to maintain indices)
  rowsToDelete.reverse().forEach((row) => {
    sheet.deleteRow(row);
  });

  ui.alert(
    `✅ Deletion complete!\n\nDeleted: ${deletedCount} files\nErrors: ${errorCount}`
  );
}

/**
 * Extract metadata from a file object
 */
function extractMetadataFromFile(file) {
  const metadata = {
    checkbox: false,
    folderUrl: SpreadsheetApp.getActiveSheet().getRange("C1").getValue(),
    imageName: file.name,
    driveLink: file.url,
    imageW: "",
    imageH: "",
    model: "",
    basePrompt: "",
    uc: "",
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

  try {
    const driveFile = DriveApp.getFileById(file.id);
    const blob = driveFile.getBlob();

    // Check if it's a NovelAI image (UUID pattern)
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;
    const isNovelAI = uuidPattern.test(file.name);

    if (isNovelAI) {
      metadata.model = "NovelAI";
    }

    // Try multiple extraction methods

    // 1. Try PNG metadata extraction
    if (file.name.toLowerCase().endsWith(".png")) {
      const pngMetadata = extractPNGMetadata(blob);
      if (pngMetadata && Object.keys(pngMetadata).length > 0) {
        mergePNGMetadata(metadata, pngMetadata);
      }
    }

    // 2. Try file description
    const description = driveFile.getDescription();
    if (description) {
      try {
        const parsed = JSON.parse(description);
        mergeJSONMetadata(metadata, parsed);
      } catch (e) {
        // Not JSON, might be plain text
        if (
          description.includes("prompt:") ||
          description.includes("NovelAI")
        ) {
          metadata.basePrompt = description;
        }
      }
    }

    // 3. Try Cloud Function if configured
    if (
      isCloudFunctionConfigured() &&
      file.name.toLowerCase().endsWith(".png")
    ) {
      try {
        const alphaMetadata = extractMetadataWithCloudFunction(file.id);
        if (alphaMetadata) {
          mergeJSONMetadata(metadata, alphaMetadata);
        }
      } catch (e) {
        console.log("Cloud Function extraction failed:", e);
      }
    }

    // 4. Try to get image dimensions from blob
    try {
      const dimensions = getImageDimensions(blob);
      if (dimensions) {
        metadata.imageW = dimensions.width;
        metadata.imageH = dimensions.height;
      }
    } catch (e) {
      console.log("Could not get image dimensions:", e);
    }
  } catch (error) {
    console.error(`Error extracting metadata from ${file.name}:`, error);
  }

  return metadata;
}

/**
 * Get image dimensions from PNG blob
 */
function getImageDimensions(blob) {
  try {
    const bytes = blob.getBytes();

    // Check PNG signature
    if (
      bytes.length > 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      // PNG dimensions are in IHDR chunk (bytes 16-23)
      const width =
        (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height =
        (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];

      if (width > 0 && height > 0 && width < 10000 && height < 10000) {
        return { width: String(width), height: String(height) };
      }
    }
  } catch (e) {
    console.error("Error reading image dimensions:", e);
  }
  return null;
}

/**
 * Merge PNG metadata into main metadata object
 */
function mergePNGMetadata(metadata, pngData) {
  // Check for parsed JSON in PNG chunks
  if (pngData.parsed_json) {
    mergeJSONMetadata(metadata, pngData.parsed_json);
  }

  // Check text chunks
  for (const [key, value] of Object.entries(pngData)) {
    if (key !== "parsed_json" && value) {
      if (
        key.toLowerCase().includes("comment") ||
        key.toLowerCase().includes("description")
      ) {
        try {
          const parsed = JSON.parse(value);
          mergeJSONMetadata(metadata, parsed);
        } catch (e) {
          // Not JSON, use as prompt
          if (!metadata.basePrompt) {
            metadata.basePrompt = value;
          }
        }
      }
    }
  }
}

/**
 * Merge JSON metadata into main metadata object
 */
function mergeJSONMetadata(metadata, json) {
  if (!json) return;

  // Extract prompt
  metadata.basePrompt =
    metadata.basePrompt ||
    json.prompt ||
    json.positive_prompt ||
    json.description ||
    json.Comment?.prompt ||
    "";

  // Extract negative prompt
  metadata.uc =
    metadata.uc ||
    json.uc ||
    json.negative_prompt ||
    json.neg_prompt ||
    json.Comment?.uc ||
    "";

  // Extract dimensions
  metadata.imageW =
    metadata.imageW || String(json.width || json.w || json.image_w || "");
  metadata.imageH =
    metadata.imageH || String(json.height || json.h || json.image_h || "");

  // Extract model
  metadata.model =
    metadata.model || json.model || json.model_name || json.sampler || "";

  // Extract character prompts
  if (json.v4_prompt?.caption?.char_captions || json.char_captions) {
    const charCaptions =
      json.v4_prompt?.caption?.char_captions || json.char_captions;
    for (let i = 0; i < Math.min(6, charCaptions.length); i++) {
      metadata[`char${i + 1}Prompt`] = charCaptions[i]?.char_caption || "";
    }
  }

  if (
    json.v4_negative_prompt?.caption?.char_captions ||
    json.neg_char_captions
  ) {
    const negCharCaptions =
      json.v4_negative_prompt?.caption?.char_captions || json.neg_char_captions;
    for (let i = 0; i < Math.min(6, negCharCaptions.length); i++) {
      metadata[`char${i + 1}UC`] = negCharCaptions[i]?.char_caption || "";
    }
  }
}

/**
 * Write metadata to sheet with preview
 */
function writeMetadataToSheet(sheet, metadata, row) {
  // Set checkbox
  sheet.getRange(row, 1).insertCheckboxes();

  // Add preview image in column B
  try {
    const file = DriveApp.getFileById(extractFileIdFromUrl(metadata.driveLink));
    const blob = file.getBlob();

    // Create thumbnail
    const thumbnailUrl = createThumbnailDataUrl(blob, 100, 100);
    if (thumbnailUrl) {
      const image = SpreadsheetApp.newCellImage()
        .setSourceUrl(thumbnailUrl)
        .setAltTextTitle(metadata.imageName)
        .build();
      sheet.getRange(row, 2).setValue(image);
    } else {
      sheet.getRange(row, 2).setValue("No preview");
    }
  } catch (e) {
    console.error("Failed to create preview:", e);
    sheet.getRange(row, 2).setValue("Preview failed");
  }

  // Write data (starting from column C)
  const values = [
    metadata.imageName, // C
    metadata.driveLink, // D
    metadata.imageW, // E
    metadata.imageH, // F
    metadata.model, // G
    metadata.basePrompt, // H
    metadata.uc, // I
    metadata.char1Prompt, // J
    metadata.char1UC, // K
    metadata.char2Prompt, // L
    metadata.char2UC, // M
    metadata.char3Prompt, // N
    metadata.char3UC, // O
    metadata.char4Prompt, // P
    metadata.char4UC, // Q
    metadata.char5Prompt, // R
    metadata.char5UC, // S
    metadata.char6Prompt, // T
    metadata.char6UC, // U
  ];

  sheet.getRange(row, 3, 1, values.length).setValues([values]);

  // Adjust row height for thumbnail
  sheet.setRowHeight(row, 120);
}

/**
 * Create thumbnail data URL
 */
function createThumbnailDataUrl(blob, maxWidth, maxHeight) {
  try {
    // For now, use original image as thumbnail
    // In production, you might want to resize it
    const base64 = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType();
    return `data:${mimeType};base64,${base64}`;
  } catch (e) {
    console.error("Failed to create thumbnail:", e);
    return null;
  }
}

/**
 * Extract file ID from Drive URL
 */
function extractFileIdFromUrl(url) {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Walk through folder and subfolders to find images
 */
function walkFolder(folderId, out) {
  const folder = DriveApp.getFolderById(folderId);

  // Get files in this folder
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const mimeType = file.getMimeType();

    if (mimeType && mimeType.startsWith("image/")) {
      out.push({
        id: file.getId(),
        name: file.getName(),
        url: file.getUrl(),
        mimeType: mimeType,
      });
    }
  }

  // Recursively process subfolders
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    walkFolder(subfolder.getId(), out);
  }
}

/**
 * Extract folder/file ID from Google Drive URL
 */
function extractFolderId(url) {
  // Match various Google Drive URL formats
  const patterns = [
    /\/folders\/([a-zA-Z0-9-_]+)/,
    /\/file\/d\/([a-zA-Z0-9-_]+)/,
    /id=([a-zA-Z0-9-_]+)/,
    /([a-zA-Z0-9-_]{25,})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
