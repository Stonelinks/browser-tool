export type Success<T> = { success: true } & T;
export type Failure = { success: false; error: string };
export type ActionResult<T = unknown> = Success<T> | Failure;

export interface ConsoleMessage {
  type: string;
  text: string;
  location?: string;
  timestamp: number;
}

export interface JsError {
  message: string;
  stack?: string;
  timestamp: number;
}

export interface ImageInfo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface NavigateResult {
  url: string;
  title: string;
  snapshot: string;
  element_count: number;
  truncated?: boolean;
}

export interface SnapshotResult {
  snapshot: string;
  element_count: number;
  truncated?: boolean;
  url: string;
  title: string;
}

export interface ClickResult {
  clicked: string;
  url: string;
}

export interface TypeResult {
  typed: string;
  ref: string;
  submitted: boolean;
}

export interface ScrollResult {
  direction: "up" | "down";
  pixels: number;
  scrollY: number;
}

export interface BackResult {
  url: string;
  title: string;
}

export interface PressResult {
  pressed: string;
}

export interface ConsoleBuffersResult {
  console_messages: ConsoleMessage[];
  js_errors: JsError[];
  total_messages: number;
  total_errors: number;
}

export interface ConsoleEvalResult {
  result: unknown;
  result_type: string;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  content_type: string;
  size: number;
  duration_ms: number;
  resource_type: string;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  body?: string;
  body_truncated?: boolean;
  timestamp: number;
}

export interface NetworkResult {
  requests: NetworkRequest[];
  total: number;
  filtered: number;
}

export interface GetImagesResult {
  images: ImageInfo[];
  count: number;
}

export interface VisionResult {
  analysis: string;
  screenshot_path: string;
  model: string;
}
