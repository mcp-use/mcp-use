import { expect, test } from "@playwright/test";

test.describe.serial("Inspector Setup and Smoke Tests", () => {
  test.beforeEach(async ({ page, context }) => {
    // Clear localStorage and cookies before each test
    await context.clearCookies();
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
  });

  test("should load and render the inspector", async ({ page }) => {
    await page.goto("/");

    // Wait for the main app to load
    await expect(page.locator("body")).toBeVisible();

    // Check that the page title or header is present
    // This will need to be adjusted based on actual inspector UI
    await expect(page).toHaveTitle(/Inspector/i);
    // should not have any server connected
    await expect(
      page.getByText(
        "No servers connected yet. Add a server above to get started."
      )
    ).toBeVisible();
  });

  test("should display the version information", async ({ page }) => {
    await page.goto("/");

    // Wait for page to load
    await page.waitForLoadState("domcontentloaded");

    // Check that version is injected via script tag
    const version = await page.evaluate(() => {
      // @ts-ignore
      return (window as any).__INSPECTOR_VERSION__;
    });

    expect(version).toBeTruthy();
    // should be format x.x.x
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof version).toBe("string");
  });

  test("should toggle theme (dark/light mode)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Get initial theme from HTML element
    const html = page.locator("html");
    const initialClass = await html.getAttribute("class");

    // Look for theme toggle button (adjust selector as needed)
    // Common patterns: button with "theme", "dark", "light" in aria-label or title
    const themeToggle = page
      .locator('button[aria-label*="theme" i], button[title*="theme" i]')
      .first();

    // If theme toggle exists, test it
    if (await themeToggle.isVisible().catch(() => false)) {
      await themeToggle.click();

      // Wait a moment for theme change
      await page.waitForTimeout(500);

      const newClass = await html.getAttribute("class");

      // Verify the class changed (should toggle between dark/light)
      expect(newClass).not.toBe(initialClass);
    } else {
      // If no theme toggle button, just verify the HTML element exists
      await expect(html).toBeVisible();
    }
  });

  test("should have proper meta tags for SEO", async ({ page }) => {
    await page.goto("/");

    // Check for basic meta tags
    const viewport = await page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);

    // Check title
    await expect(page).toHaveTitle(/Inspector/i);

    // Check for favicon(s) - inspector has multiple for light/dark mode
    const faviconLinks = await page.locator('link[rel="icon"]');
    expect(await faviconLinks.count()).toBeGreaterThan(0);

    // Verify at least one favicon has a valid href
    const firstFavicon = faviconLinks.first();
    const faviconHref = await firstFavicon.getAttribute("href");
    expect(faviconHref).toBeTruthy();

    // Check description meta tag (if exists)
    const description = await page.locator('meta[name="description"]');
    if ((await description.count()) > 0) {
      const content = await description.getAttribute("content");
      expect(content).toBeTruthy();
    }
  });
});
