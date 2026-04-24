export interface ProviderStatus {
  id: string;
  name: string;
  isOAuth: boolean;
  usesCallbackServer: boolean;
  auth: { configured: boolean; source?: string; label?: string };
}

export interface AvailableModelSummary {
  provider: string;
  id: string;
  name: string;
}

export type ClientMessage =
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "new_session" }
  | { type: "switch_session"; sessionFile: string }
  | { type: "get_sessions" }
  | { type: "get_state" }
  | { type: "get_available_models" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "cycle_model"; direction?: "forward" | "backward" }
  | { type: "login_start"; provider: string }
  | { type: "login_abort" }
  | { type: "login_prompt_response"; promptId: string; value: string }
  | { type: "logout"; provider: string }
  | { type: "get_auth_status" };

export type LoginEvent =
  | { type: "login_device_flow"; provider: string; url: string; code: string }
  | { type: "login_open_url"; provider: string; url: string }
  | { type: "login_progress"; provider: string; message: string }
  | { type: "login_prompt"; provider: string; promptId: string; message: string; placeholder?: string }
  | { type: "login_complete"; provider: string }
  | { type: "login_error"; provider: string; message: string };

export type ServerMessage =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_update"; id: string; name: string; output: string }
  | { type: "tool_result"; id: string; name: string; output: string; isError: boolean }
  | { type: "error"; message: string }
  | { type: "state"; isStreaming: boolean; sessionId: string; sessionFile?: string; model: string | null; thinkingLevel: string; messageCount: number }
  | { type: "sessions"; sessions: Array<{ id: string; file: string; name?: string; firstMessage: string; modified: string }> }
  | { type: "available_models"; models: AvailableModelSummary[] }
  | { type: "auth_status"; providers: ProviderStatus[] }
  | LoginEvent;
