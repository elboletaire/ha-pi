/**
 * pi-channels — LLM tool registration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ChannelRegistry } from "./registry.ts";

/**
 * Allowed base directories for send_file.
 * Only files under these paths (resolved, symlink-safe) can be sent.
 * Prevents exfiltration of sensitive system files via prompt injection.
 */
const ALLOWED_SEND_DIRS = [
	os.tmpdir(),                             // /tmp — generated reports, exports
	path.join(os.homedir(), "Downloads"),     // ~/Downloads
	path.join(os.homedir(), "Documents"),     // ~/Documents
	path.join(os.homedir(), "src"),           // ~/src — project files
	path.join(os.homedir(), ".pi"),           // ~/.pi — agent workspace files
];

/**
 * Blocked path patterns — even if under an allowed dir.
 * Matches against the resolved absolute path.
 */
const BLOCKED_PATH_PATTERNS = [
	/\.env$/,                    // .env files (secrets)
	/\.env\.[a-z]+$/,           // .env.local, .env.production, etc.
	/\/\.git\//,                // .git internals
	/\/node_modules\//,         // node_modules (huge, never useful)
	/\/\.ssh\//,                // SSH keys
	/\/\.gnupg\//,              // GPG keys
	/\/\.aws\//,                // AWS credentials
	/id_rsa/,                   // SSH private keys
	/id_ed25519/,               // SSH private keys
	/\.pem$/,                   // Certificates/keys
	/\.key$/,                   // Private keys
	/settings\.json$/,          // pi settings (contains tokens/API keys)
];

/**
 * Validate that a file path is safe to send externally.
 * Returns null if safe, or an error message if blocked.
 */
function validateFilePath(filePath: string): string | null {
	// Resolve to absolute, following symlinks
	let resolved: string;
	try {
		resolved = fs.realpathSync(filePath);
	} catch {
		// If realpath fails, resolve without following symlinks
		resolved = path.resolve(filePath);
	}

	// Check blocked patterns first (even if under allowed dir)
	for (const pattern of BLOCKED_PATH_PATTERNS) {
		if (pattern.test(resolved)) {
			return `Blocked: file matches a sensitive path pattern (${pattern.source})`;
		}
	}

	// Check if under any allowed directory
	const isAllowed = ALLOWED_SEND_DIRS.some(dir => {
		const resolvedDir = path.resolve(dir);
		return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
	});

	if (!isAllowed) {
		return `Blocked: file is outside allowed directories. Allowed: ${ALLOWED_SEND_DIRS.map(d => d.replace(os.homedir(), "~")).join(", ")}`;
	}

	return null; // Safe
}

interface ChannelToolParams {
	action: "send" | "send_file" | "list" | "test";
	adapter?: string;
	recipient?: string;
	text?: string;
	source?: string;
	file_path?: string;
	caption?: string;
}

export function registerChannelTool(pi: ExtensionAPI, registry: ChannelRegistry): void {
	pi.registerTool({
		name: "notify",
		label: "Channel",
		description:
			"Send notifications via configured adapters (Telegram, webhooks, custom). " +
			"Actions: send (deliver a message), send_file (send a file/document — PDF, CSV, images, etc.), list (show adapters + routes), test (send a ping).",
		parameters: Type.Object({
			action: StringEnum(
				["send", "send_file", "list", "test"] as const,
				{ description: "Action to perform" },
			) as any,
			adapter: Type.Optional(
				Type.String({ description: "Adapter name or route alias (required for send, send_file, test)" }),
			),
			recipient: Type.Optional(
				Type.String({ description: "Recipient — chat ID, webhook URL, etc. (required for send unless using a route)" }),
			),
			text: Type.Optional(
				Type.String({ description: "Message text (required for send)" }),
			),
			source: Type.Optional(
				Type.String({ description: "Source label (optional)" }),
			),
			file_path: Type.Optional(
				Type.String({ description: "Absolute path to the file to send (required for send_file)" }),
			),
			caption: Type.Optional(
				Type.String({ description: "Caption text for the file (optional, for send_file)" }),
			),
		}) as any,

		async execute(_toolCallId, _params) {
			const params = _params as ChannelToolParams;
			let result: string;

			switch (params.action) {
				case "list": {
					const items = registry.list();
					if (items.length === 0) {
						result = 'No adapters configured. Add "pi-channels" to your settings.json.';
					} else {
						const lines = items.map(i =>
							i.type === "route"
								? `- **${i.name}** (route → ${i.target})`
								: `- **${i.name}** (${i.direction ?? "adapter"})`
						);
						result = `**Channel (${items.length}):**\n${lines.join("\n")}`;
					}
					break;
				}
				case "send": {
					if (!params.adapter || !params.text) {
						result = "Missing required fields: adapter and text.";
						break;
					}
					const r = await registry.send({
						adapter: params.adapter,
						recipient: params.recipient ?? "",
						text: params.text,
						source: params.source,
					});
					result = r.ok
						? `✓ Sent via "${params.adapter}"${params.recipient ? ` to ${params.recipient}` : ""}`
						: `Failed: ${r.error}`;
					break;
				}
				case "send_file": {
					if (!params.adapter || !params.file_path) {
						result = "Missing required fields: adapter and file_path.";
						break;
					}

					// Security: validate path is in allowed directories
					const pathError = validateFilePath(params.file_path);
					if (pathError) {
						result = pathError;
						break;
					}

					// Validate file exists
					try {
						if (!fs.existsSync(params.file_path)) {
							result = `File not found: ${params.file_path}`;
							break;
						}
						const stat = fs.statSync(params.file_path);
						if (!stat.isFile()) {
							result = `Not a file: ${params.file_path}`;
							break;
						}
						// Telegram max file size: 50MB for bots
						if (stat.size > 50 * 1024 * 1024) {
							result = `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Telegram limit: 50MB.`;
							break;
						}
					} catch (err: any) {
						result = `Cannot access file: ${err.message}`;
						break;
					}

					const r = await registry.sendFile(
						params.adapter,
						params.recipient ?? "",
						params.file_path,
						params.caption,
					);
					result = r.ok
						? `✓ File sent via "${params.adapter}"${params.recipient ? ` to ${params.recipient}` : ""}: ${params.file_path}`
						: `Failed: ${r.error}`;
					break;
				}
				case "test": {
					if (!params.adapter) {
						result = "Missing required field: adapter.";
						break;
					}
					const r = await registry.send({
						adapter: params.adapter,
						recipient: params.recipient ?? "",
						text: `🏓 pi-channels test — ${new Date().toISOString()}`,
						source: "channel:test",
					});
					result = r.ok
						? `✓ Test sent via "${params.adapter}"${params.recipient ? ` to ${params.recipient}` : ""}`
						: `Failed: ${r.error}`;
					break;
				}
				default:
					result = `Unknown action: ${(params as any).action}`;
			}

			return {
				content: [{ type: "text" as const, text: result }],
				details: {},
			};
		},
	});
}
