import { withSession, failure } from "./_helpers.js";
import type { ActionResult, NetworkResult, NetworkRequest } from "../types.js";

export interface NetworkInput {
  clear?: boolean;
  filter?: {
    url_pattern?: string;
    resource_type?: string;
    method?: string;
    status_code?: number;
  };
  taskId?: string;
}

export async function browserNetwork(
  input: NetworkInput = {},
): Promise<ActionResult<NetworkResult>> {
  return withSession(input.taskId, async (session) => {
    let requests: NetworkRequest[] = [...session.networkBuffer];
    const total = requests.length;
    let filtered = 0;

    if (input.filter) {
      const { url_pattern, resource_type, method, status_code } = input.filter;

      if (url_pattern) {
        try {
          const regex = new RegExp(url_pattern);
          requests = requests.filter((r) => regex.test(r.url));
        } catch (err) {
          return failure(
            `invalid url_pattern regex: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (resource_type) {
        requests = requests.filter(
          (r) => r.resource_type.toLowerCase() === resource_type.toLowerCase(),
        );
      }

      if (method) {
        requests = requests.filter(
          (r) => r.method.toUpperCase() === method.toUpperCase(),
        );
      }

      if (status_code !== undefined) {
        requests = requests.filter((r) => r.status === status_code);
      }

      filtered = total - requests.length;
    }

    if (input.clear) session.clearNetworkBuffer();

    return {
      success: true,
      requests,
      total,
      filtered,
    };
  });
}
