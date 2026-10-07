import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

// Only called by isolated synthetic browser fixtures; never targets the shared server.
export async function captureUIReview(page: Page, name: string) {
  if (process.env.UI_REVIEW !== "1") return;
  if (
    process.env.UI_REVIEW_TARGETS &&
    !process.env.UI_REVIEW_TARGETS.split(",").includes(name)
  )
    return;
  const preparationTab: Record<string, string> = {
    platforms: "채팅 플랫폼",
    media: "화면·음성",
    ai: "AI 계정·모델",
    output: "리더·OBS",
  };
  if (preparationTab[name])
    await expect(
      page.getByRole("tab", { name: preparationTab[name], exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  const original = page.viewportSize();
  mkdirSync(".impeccable/review", { recursive: true });
  const results = [];
  for (const [suffix, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      scrollTo(0, 0);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await page.screenshot({
      path: `.impeccable/review/${name}-${suffix}.png`,
      fullPage: true,
      animations: "disabled",
    });
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      shortControls: [
        ...document.querySelectorAll<HTMLElement>(
          "button,input,select,summary",
        ),
      ]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            el.checkVisibility() &&
            (box.height < 44 || box.width < 44)
          );
        })
        .map((el) => ({
          text:
            el.textContent?.trim().slice(0, 80) ||
            el.getAttribute("aria-label") ||
            el.tagName,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        })),
    }));
    results.push({
      viewport: suffix,
      geometry,
      violations: accessibility.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    });
  }
  writeFileSync(
    `.impeccable/review/${name}-audit.json`,
    JSON.stringify(results, null, 2),
  );
  if (original) await page.setViewportSize(original);
}
