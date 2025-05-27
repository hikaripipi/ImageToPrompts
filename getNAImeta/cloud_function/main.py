"""
Google Cloud Function for NovelAI Alpha Channel Extraction
Deploy this as a Cloud Function to enable alpha channel extraction from GAS
"""

import json
import base64
import gzip
import re
from io import BytesIO
import functions_framework
from PIL import Image
import numpy as np


def byteize(alpha):
    """Convert alpha channel to bytes (from NovelAI official code)"""
    alpha = alpha.T.reshape((-1,))
    alpha = alpha[: (alpha.shape[0] // 8) * 8]
    alpha = np.bitwise_and(alpha, 1)
    alpha = alpha.reshape((-1, 8))
    alpha = np.packbits(alpha, axis=1)
    return alpha


class LSBExtractor:
    """LSB (Least Significant Bit) extractor for alpha channel"""

    def __init__(self, data):
        self.data = byteize(data[..., -1])
        self.pos = 0

    def get_one_byte(self):
        if self.pos >= len(self.data):
            return None
        byte = self.data[self.pos]
        self.pos += 1
        return byte

    def get_next_n_bytes(self, n):
        if self.pos + n > len(self.data):
            return bytearray()
        n_bytes = self.data[self.pos : self.pos + n]
        self.pos += n
        return bytearray(n_bytes)

    def read_32bit_integer(self):
        bytes_list = self.get_next_n_bytes(4)
        if len(bytes_list) == 4:
            integer_value = int.from_bytes(bytes_list, byteorder="big")
            return integer_value
        else:
            return None


def extract_from_alpha_channel(image_data):
    """Extract metadata from alpha channel using NovelAI's stealth method"""
    try:
        # Convert base64 to PIL Image
        image_bytes = base64.b64decode(image_data)
        image = Image.open(BytesIO(image_bytes)).convert("RGBA")
        image_array = np.array(image)

        if image_array.shape[-1] != 4 or len(image_array.shape) != 3:
            return None

        reader = LSBExtractor(image_array)
        magic = "stealth_pngcomp"

        try:
            read_magic = reader.get_next_n_bytes(len(magic)).decode("utf-8")
        except:
            return None

        if magic != read_magic:
            return None

        read_len = reader.read_32bit_integer()
        if read_len is None:
            return None

        read_len = read_len // 8
        json_data = reader.get_next_n_bytes(read_len)

        try:
            json_data = json.loads(gzip.decompress(json_data).decode("utf-8"))
        except:
            return None

        # Handle nested Comment JSON
        if "Comment" in json_data and isinstance(json_data["Comment"], str):
            try:
                json_data["Comment"] = json.loads(json_data["Comment"])
            except:
                pass

        return json_data

    except Exception as e:
        print(f"Alpha channel extraction failed: {e}")
        return None


def extract_prompt_data(json_data):
    """Extract prompt information from JSON data"""
    if not json_data:
        return {}

    def first(*values):
        """Return first non-empty value"""
        for v in values:
            if isinstance(v, str):
                v = v.strip()
            if v not in ("", None, []):
                return v
        return ""

    # Extract basic prompts
    base_prompt = first(
        json_data.get("v4_prompt", {}).get("caption", {}).get("base_caption"),
        json_data.get("prompt"),
        json_data.get("Comment", {})
        .get("v4_prompt", {})
        .get("caption", {})
        .get("base_caption"),
        json_data.get("Comment", {}).get("prompt"),
    )

    uc_prompt = first(
        json_data.get("uc"),
        json_data.get("v4_negative_prompt", {}).get("caption", {}).get("base_caption"),
        json_data.get("Comment", {}).get("uc"),
        json_data.get("Comment", {})
        .get("v4_negative_prompt", {})
        .get("caption", {})
        .get("base_caption"),
    )

    # Extract model info
    model = first(
        json_data.get("model"),
        json_data.get("sampler"),
        json_data.get("Software"),
        json_data.get("Source"),
        json_data.get("Comment", {}).get("model"),
        json_data.get("Comment", {}).get("sampler"),
        f"v{json_data.get('version')}" if json_data.get("version") else "",
        f"v{json_data.get('Comment', {}).get('version')}"
        if json_data.get("Comment", {}).get("version")
        else "",
    )

    # Extract dimensions
    width = first(
        json_data.get("width"),
        json_data.get("Comment", {}).get("width"),
    )

    height = first(
        json_data.get("height"),
        json_data.get("Comment", {}).get("height"),
    )

    # Extract character prompts
    char_captions = []
    pos_chars = json_data.get("v4_prompt", {}).get("caption", {}).get(
        "char_captions", []
    ) or json_data.get("Comment", {}).get("v4_prompt", {}).get("caption", {}).get(
        "char_captions", []
    )
    neg_chars = json_data.get("v4_negative_prompt", {}).get("caption", {}).get(
        "char_captions", []
    ) or json_data.get("Comment", {}).get("v4_negative_prompt", {}).get(
        "caption", {}
    ).get("char_captions", [])

    for i in range(6):
        char_prompt = pos_chars[i]["char_caption"] if i < len(pos_chars) else ""
        char_uc = neg_chars[i]["char_caption"] if i < len(neg_chars) else ""

        char_captions.append({"char_caption": char_prompt, "char_uc": char_uc})

    return {
        "prompt": base_prompt,
        "uc": uc_prompt,
        "model": model,
        "width": width,
        "height": height,
        "char_captions": char_captions,
        "raw_data": json_data,
    }


def extract_from_png_text_chunks(image_data):
    """Extract metadata from PNG tEXt chunks (standard metadata)"""
    try:
        image_bytes = base64.b64decode(image_data)
        image = Image.open(BytesIO(image_bytes))

        # Get PNG info
        if hasattr(image, "info"):
            metadata = {}

            # Common NovelAI metadata fields in tEXt chunks
            for key in ["Title", "Description", "Comment", "Software", "Source"]:
                if key in image.info:
                    value = image.info[key]
                    # Try to parse as JSON if it looks like JSON
                    if isinstance(value, str) and value.strip().startswith("{"):
                        try:
                            metadata[key] = json.loads(value)
                        except:
                            metadata[key] = value
                    else:
                        metadata[key] = value

            # Also check for any other text chunks
            for key, value in image.info.items():
                if key not in metadata:
                    metadata[key] = value

            return metadata if metadata else None

        return None

    except Exception as e:
        print(f"PNG text chunk extraction failed: {e}")
        return None


@functions_framework.http
def extract_novelai_metadata(request):
    """
    Cloud Function entry point for NovelAI metadata extraction

    Expected request format:
    {
        "image_data": "base64_encoded_image",
        "filename": "image_filename.png"
    }

    Response format:
    {
        "success": true/false,
        "metadata": {...},
        "error": "error_message" (if failed)
    }
    """

    # Set CORS headers
    if request.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "3600",
        }
        return ("", 204, headers)

    headers = {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}

    try:
        # Parse request
        request_json = request.get_json(silent=True)
        if not request_json:
            return (
                json.dumps({"success": False, "error": "Invalid JSON in request"}),
                400,
                headers,
            )

        image_data = request_json.get("image_data")
        filename = request_json.get("filename", "unknown.png")

        if not image_data:
            return (
                json.dumps({"success": False, "error": "No image_data provided"}),
                400,
                headers,
            )

        # Extract metadata from alpha channel
        raw_metadata = extract_from_alpha_channel(image_data)

        # Also try to extract from PNG text chunks
        text_metadata = extract_from_png_text_chunks(image_data)

        if not raw_metadata and not text_metadata:
            return (
                json.dumps(
                    {
                        "success": False,
                        "error": "No metadata found in alpha channel or PNG text chunks",
                    }
                ),
                404,
                headers,
            )

        # Combine metadata from both sources
        combined_metadata = {}

        # Start with text metadata if available
        if text_metadata:
            combined_metadata.update(text_metadata)

        # Alpha channel metadata takes precedence if available
        if raw_metadata:
            combined_metadata = raw_metadata
            # But preserve text metadata as additional info
            if text_metadata:
                combined_metadata["text_metadata"] = text_metadata

        # Process and structure the metadata
        processed_metadata = extract_prompt_data(combined_metadata)

        return (
            json.dumps(
                {"success": True, "metadata": processed_metadata, "filename": filename}
            ),
            200,
            headers,
        )

    except Exception as e:
        return (
            json.dumps({"success": False, "error": f"Processing error: {str(e)}"}),
            500,
            headers,
        )


# For local testing
if __name__ == "__main__":
    # Test function locally
    import sys

    if len(sys.argv) > 1:
        test_image_path = sys.argv[1]

        with open(test_image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        # Simulate request
        class MockRequest:
            def __init__(self, data):
                self.data = data

            def get_json(self, silent=True):
                return self.data

            method = "POST"

        request = MockRequest(
            {"image_data": image_data, "filename": test_image_path.split("/")[-1]}
        )

        result = extract_novelai_metadata(request)
        print(result[0])  # Print response body
    else:
        print("Usage: python cloud_function_alpha_extractor.py <image_path>")
