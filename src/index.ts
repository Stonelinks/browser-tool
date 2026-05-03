export { browserNavigate, type NavigateInput } from "./actions/navigate.js";
export { browserSnapshot, type SnapshotInput } from "./actions/snapshot.js";
export { browserClick, type ClickInput } from "./actions/click.js";
export { browserType, type TypeInput } from "./actions/type.js";
export { browserScroll, type ScrollInput } from "./actions/scroll.js";
export { browserBack, type BackInput } from "./actions/back.js";
export { browserPress, type PressInput } from "./actions/press.js";
export { browserConsole, type ConsoleInput } from "./actions/console.js";
export { browserGetImages, type GetImagesInput } from "./actions/getImages.js";
export { browserVision, type VisionInput } from "./actions/vision.js";
export { browserNetwork, type NetworkInput } from "./actions/network.js";

export { SessionManager } from "./session/manager.js";
export { Session } from "./session/session.js";
export { registerLifecycleHandlers } from "./session/lifecycle.js";
export { getConfig, resetConfig, type Config } from "./config.js";
export {
  TOOL_SPECS,
  findSpec,
  type ToolSpec,
  type ToolHandler,
} from "./schema.js";

export type {
  ActionResult,
  Success,
  Failure,
  ConsoleMessage,
  JsError,
  ImageInfo,
  NavigateResult,
  SnapshotResult,
  ClickResult,
  TypeResult,
  ScrollResult,
  BackResult,
  PressResult,
  ConsoleBuffersResult,
  ConsoleEvalResult,
  NetworkRequest,
  NetworkResult,
  GetImagesResult,
  VisionResult,
} from "./types.js";
