/**
 * PDF text extraction helper — converts PDF files to plain text.
 *
 * Uses pdftotext (from poppler-utils) via child_process.
 * Install: `sudo pacman -S poppler` (Arch) or `sudo apt install poppler-utils` (Debian/Ubuntu)
 *
 * Fallback: if pdftotext is not available, uses a minimal raw text extraction
 * that handles simple PDFs (no OCR, no complex layouts).
 */

import { execFileSync } from "node:child_process";

/** Maximum text output size (500 KB — keep prompts reasonable). */
const MAX_TEXT_SIZE = 512_000;

/**
 * Extract text from a PDF file.
 *
 * @param inputPath - Path to input PDF file
 * @returns Extracted text, or null if extraction fails
 */
export function extractPdfText(inputPath: string): string | null {
	// Try pdftotext first (best quality)
	const text = extractWithPdftotext(inputPath);
	if (text) return text;

	// Fallback: basic raw extraction
	return extractRawText(inputPath);
}

/**
 * Extract text using pdftotext (poppler-utils).
 * Outputs to stdout with `-` as output filename.
 */
function extractWithPdftotext(inputPath: string): string | null {
	try {
		const result = execFileSync("pdftotext", [
			"-layout",   // Maintain original physical layout
			"-nopgbrk",  // Don't insert page break characters
			inputPath,
			"-",         // Output to stdout
		], {
			maxBuffer: MAX_TEXT_SIZE * 2,
			timeout: 30_000, // 30s — enough for large PDFs
		});
		const text = result.toString("utf-8").trim();
		if (!text) return null;
		// Truncate if too large
		if (text.length > MAX_TEXT_SIZE) {
			return text.slice(0, MAX_TEXT_SIZE) + "\n\n[… text truncated — PDF too large]";
		}
		return text;
	} catch {
		return null;
	}
}

/**
 * Minimal fallback: read raw PDF and extract visible text streams.
 * Handles simple PDFs but won't work well with complex layouts,
 * encrypted files, or scanned documents.
 */
function extractRawText(inputPath: string): string | null {
	try {
		const fs = require("node:fs");
		const raw = fs.readFileSync(inputPath);
		const content = raw.toString("latin1");

		const textParts: string[] = [];

		// Extract text between BT (Begin Text) and ET (End Text) operators
		const btEtRegex = /BT\s([\s\S]*?)ET/g;
		let match: RegExpExecArray | null;
		while ((match = btEtRegex.exec(content)) !== null) {
			const block = match[1];

			// Extract string literals in parentheses: (text)
			const parenRegex = /\(([^)]*)\)/g;
			let strMatch: RegExpExecArray | null;
			while ((strMatch = parenRegex.exec(block)) !== null) {
				const decoded = strMatch[1]
					.replace(/\\n/g, "\n")
					.replace(/\\r/g, "\r")
					.replace(/\\t/g, "\t")
					.replace(/\\\\/g, "\\")
					.replace(/\\\(/g, "(")
					.replace(/\\\)/g, ")");
				if (decoded.trim()) textParts.push(decoded);
			}

			// Extract hex strings: <hex>
			const hexRegex = /<([0-9A-Fa-f\s]+)>/g;
			let hexMatch: RegExpExecArray | null;
			while ((hexMatch = hexRegex.exec(block)) !== null) {
				const hex = hexMatch[1].replace(/\s/g, "");
				if (hex.length % 2 !== 0) continue;
				let decoded = "";
				for (let i = 0; i < hex.length; i += 2) {
					const charCode = parseInt(hex.substring(i, i + 2), 16);
					if (charCode >= 32 && charCode < 127) decoded += String.fromCharCode(charCode);
				}
				if (decoded.trim()) textParts.push(decoded);
			}
		}

		const text = textParts.join(" ").replace(/\s+/g, " ").trim();
		if (!text || text.length < 10) return null;

		if (text.length > MAX_TEXT_SIZE) {
			return text.slice(0, MAX_TEXT_SIZE) + "\n\n[… text truncated — PDF too large]";
		}
		return text;
	} catch {
		return null;
	}
}
