import { withSession, failure, errorMessage } from "./_helpers.js";
import type { ActionResult, GetImagesResult, ImageInfo } from "../types.js";

export interface GetImagesInput {
  taskId?: string;
}

export async function browserGetImages(
  input: GetImagesInput = {},
): Promise<ActionResult<GetImagesResult>> {
  return withSession(input.taskId, async (session) => {
    try {
      const images = await session.page.evaluate((): ImageInfo[] => {
        const out: ImageInfo[] = [];
        const imgs = document.querySelectorAll("img");
        for (const img of Array.from(imgs)) {
          const src = (img as HTMLImageElement).src;
          if (!src) continue;
          if (src.startsWith("data:")) continue;
          out.push({
            src,
            alt: (img as HTMLImageElement).alt || "",
            width:
              (img as HTMLImageElement).naturalWidth ||
              (img as HTMLImageElement).width ||
              0,
            height:
              (img as HTMLImageElement).naturalHeight ||
              (img as HTMLImageElement).height ||
              0,
          });
        }
        return out;
      });
      return {
        success: true,
        images,
        count: images.length,
      } as ActionResult<GetImagesResult>;
    } catch (err) {
      return failure(`get_images failed: ${errorMessage(err)}`);
    }
  });
}
