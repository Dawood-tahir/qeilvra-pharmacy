import { expect, test, type Page } from "@playwright/test";
import { medicine } from "../ui/data";

const medicines = Array.from({ length: 20 }, (_, index) => ({
  ...medicine,
  id: "grid-medicine-" + index,
  name: index === 0 ? "Amoxicillin and Clavulanic Acid with a long medicine name" : index === 1 ? "MedicineWithAnUnbrokenNameThatMustWrapWithinItsCardWithoutHidingControls" : "Medicine " + (index + 1),
  strength: index === 0 ? "875mg / 125mg" : medicine.strength,
  units: medicine.units.slice(0, index % 3 + 1),
}));

async function openCatalog(page: Page) {
  await page.route("**/api/medicines/search?**", route => route.fulfill({
    json: new URL(route.request().url()).searchParams.get("q") === "rare-grid-match" ? [medicines[0]] : medicines,
  }));
  await page.goto("/pos?shell=1");
  await expect(page.locator(".pos-medicine-card")).toHaveCount(medicines.length);
}

async function gridGeometry(page: Page) {
  return page.locator(".pos-medicines").evaluate(grid => {
    const cards = [...grid.querySelectorAll(".pos-medicine-card")].map(card => card.getBoundingClientRect());
    const style = getComputedStyle(grid);
    return {
      width: grid.getBoundingClientRect().width,
      availableWidth: grid.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
      gutter: (grid as HTMLElement).offsetWidth - grid.clientWidth,
      gap: Number.parseFloat(style.columnGap),
      columns: cards.filter(card => Math.abs(card.top - cards[0].top) < 1).length,
      cardWidth: cards[0].width,
    };
  });
}

async function assertCardsFit(page: Page) {
  const geometry = await page.locator(".pos-medicines").evaluate(grid => ({
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
    gridOverflow: grid.scrollWidth > grid.clientWidth + 1,
    cards: [...grid.querySelectorAll<HTMLElement>(".pos-medicine-card")].map(card => {
      const bounds = card.getBoundingClientRect();
      const actions = card.querySelector(".pos-medicine-actions")!.getBoundingClientRect();
      return {
        name: card.querySelector("h2")!.textContent,
        top: bounds.top, height: bounds.height, width: bounds.width, actionsBottom: actions.bottom,
        overflow: card.scrollWidth > card.clientWidth + 1,
        units: card.querySelectorAll(".pos-selling-units button").length,
        quantityInputs: card.querySelectorAll('input[type="number"]').length,
        addButtons: [...card.querySelectorAll("button")].filter(button => button.textContent?.trim() === "Add to Cart").length,
        controls: [...card.querySelectorAll("button, input")].map(control => {
          const box = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          const range = document.createRange();
          range.selectNodeContents(control);
          const content = control.textContent?.trim() ? range.getBoundingClientRect() : control.querySelector("svg")?.getBoundingClientRect();
          return {
            label: control.getAttribute("aria-label") ?? control.textContent?.trim(),
            height: box.height,
            insideCard: box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
            labelFits: !content || (content.width > 0 && content.left >= box.left + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth) - 1 && content.right <= box.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth) + 1),
          };
        }),
      };
    }),
  }));
  expect(geometry.pageOverflow, "The POS must not scroll horizontally").toBe(false);
  expect(geometry.gridOverflow, "Medicine results must not scroll horizontally").toBe(false);
  for (const [index, card] of geometry.cards.entries()) {
    expect(card.width, `${card.name} stays compact`).toBeLessThanOrEqual(361);
    expect(card.overflow, `${card.name} wraps within its card`).toBe(false);
    expect(card.units).toBe(medicines[index].units.length);
    expect(card.quantityInputs).toBe(1);
    expect(card.addButtons).toBe(1);
    for (const control of card.controls) {
      expect(control.height, `${control.label} remains operable`).toBeGreaterThanOrEqual(44);
      expect(control.insideCard, `${control.label} fits inside the card`).toBe(true);
      expect(control.labelFits, `${control.label} remains readable`).toBe(true);
    }
    const row = geometry.cards.filter(other => Math.abs(other.top - card.top) < 1);
    expect(Math.max(...row.map(other => other.height)) - Math.min(...row.map(other => other.height)), "Cards in the same row align").toBeLessThanOrEqual(1);
    expect(Math.max(...row.map(other => other.actionsBottom)) - Math.min(...row.map(other => other.actionsBottom)), "Quantity and Add to Cart align along the row").toBeLessThanOrEqual(1);
  }
}

test("medicine cards stay compact and readable with varied names, units and sparse results", async ({ page }) => {
  await openCatalog(page);
  await expect(page.locator(".pos-medicine-card img, .pos-medicine-card [role=img]")).toHaveCount(0);
  await assertCardsFit(page);
  const fullGrid = await gridGeometry(page);
  const lastAdd = page.locator(".pos-medicine-card").last().getByRole("button", { name: "Add to Cart", exact: true });
  await lastAdd.scrollIntoViewIfNeeded();
  await expect(lastAdd).toBeInViewport({ ratio: 1 });
  await page.getByRole("textbox", { name: "Medicine search" }).fill("rare-grid-match");
  await expect(page.locator(".pos-medicine-card")).toHaveCount(1);
  await assertCardsFit(page);
  const sparseGrid = await gridGeometry(page);
  // Removing a scrollbar can reclaim a few pixels. A single search result must
  // otherwise retain its normal slot instead of stretching across the catalog.
  expect(sparseGrid.cardWidth).toBeLessThanOrEqual(fullGrid.cardWidth + 8);
});

test("medicine columns respond to sidebar space and desktop resizing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "width-1440", "The resize sequence runs once; card coverage uses all nine projects.");
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.addInitScript(() => localStorage.setItem("qeilvra-sidebar", "expanded"));
  await openCatalog(page);
  const expanded = await gridGeometry(page);
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect.poll(async () => Math.round((await page.locator("#desktop-sidebar").boundingBox())!.width)).toBe(80);
  const collapsed = await gridGeometry(page);
  expect(collapsed.width).toBeGreaterThan(expanded.width);
  expect(collapsed.columns).toBeGreaterThan(expanded.columns);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const wide = await gridGeometry(page);
  expect(wide.width).toBeGreaterThan(collapsed.width);
  expect(wide.columns).toBeGreaterThan(collapsed.columns);
  await page.setViewportSize({ width: 1024, height: 1000 });
  const laptop = await gridGeometry(page);
  expect(laptop.width).toBeLessThan(wide.width);
  expect(laptop.columns).toBeLessThan(wide.columns);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect.poll(async () => Math.round((await page.locator("#desktop-sidebar").boundingBox())!.width)).toBe(224);
  const laptopExpanded = await gridGeometry(page);
  expect(laptopExpanded.width).toBeLessThan(laptop.width);
  expect(laptopExpanded.columns).toBeLessThan(laptop.columns);
  await assertCardsFit(page);
});

async function classicScrollbar(page: Page) {
  // Headless Chromium normally overlays its scrollbar. Reserving a stable
  // gutter and overriding the existing thin width reproduces Windows layout.
  await page.addStyleTag({ content: ".pos-medicines, .pos-cart-items { scrollbar-gutter: stable; scrollbar-width: auto; } .pos-medicines::-webkit-scrollbar, .pos-cart-items::-webkit-scrollbar { width: 17px; }" });
  await expect.poll(async () => (await gridGeometry(page)).gutter, "The regression must consume real horizontal space for its scrollbar").toBeGreaterThanOrEqual(10);
}

async function comfortableColumns(page: Page, minimum: number) {
  const grid = await gridGeometry(page);
  expect(grid.gutter, "The classic scrollbar remains present after resizing").toBeGreaterThanOrEqual(10);
  expect(grid.cardWidth, "Medicine controls retain their comfortable card width").toBeGreaterThanOrEqual(Math.min(minimum, grid.availableWidth) - 1);
  const fittingColumns = Math.max(1, Math.floor((grid.availableWidth + grid.gap + 1) / (minimum + grid.gap)));
  expect(grid.columns, "Use the number of comfortable cards that fit the measured catalog space").toBe(fittingColumns);
  await assertCardsFit(page);
  const cart = await page.locator(".pos-cart-items").evaluate(element => ({
    gutter: (element as HTMLElement).offsetWidth - element.clientWidth,
    scrolls: element.scrollHeight > element.clientHeight,
    rows: [...element.querySelectorAll<HTMLElement>(".pos-cart-row")].map(row => {
      const bounds = row.getBoundingClientRect();
      return {
        name: row.querySelector("h3")!.textContent,
        overflow: row.scrollWidth > row.clientWidth + 1,
        controlsFit: [...row.querySelectorAll("button, input")].every(control => {
          const box = control.getBoundingClientRect();
          return box.height >= 44 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
        }),
      };
    }),
  }));
  expect(cart.gutter, "Cart medicines also reserve a classic scrollbar gutter").toBeGreaterThanOrEqual(10);
  expect(cart.scrolls).toBe(true);
  expect(cart.rows).toHaveLength(medicines.length);
  for (const row of cart.rows) {
    expect(row.overflow, `${row.name} cart row does not overflow`).toBe(false);
    expect(row.controlsFit, `${row.name} cart quantities and removal remain operable`).toBe(true);
  }
  return grid;
}

for (const pointer of [
  { name: "desktop", width: 1280, minimum: 250, touch: false },
  { name: "touch", width: 1366, minimum: 270, touch: true },
]) test(`classic scrollbars preserve the ${pointer.name} medicine grid at 150% zoom-equivalent sizing`, async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "width-1440", "These two scrollbar and resize cases run once.");
  const context = await browser.newContext({ baseURL, viewport: { width: pointer.width, height: 633 }, deviceScaleFactor: 1.5, hasTouch: pointer.touch });
  try {
    const page = await context.newPage();
    await page.addInitScript(medicines => {
      localStorage.setItem("qeilvra-sidebar", "expanded");
      sessionStorage.setItem("qeilvra-cart-v2-fixture", JSON.stringify({
        cart: medicines.map(item => ({ ...item, quantity: 1, unit: item.units[0], lineKey: item.id + ":base" })),
        discount: "0", discountMode: "fixed", extraAmount: "0", extraDescription: "",
      }));
    }, medicines);
    await openCatalog(page);
    await classicScrollbar(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(pointer.touch);
    const expanded = await comfortableColumns(page, pointer.minimum);
    // This specific desktop regression has room for two cards even after a
    // classic gutter. Other widths use measured capacity rather than a fixed count.
    expect(expanded.availableWidth).toBeGreaterThanOrEqual(pointer.minimum * 2 + expanded.gap);
    expect(expanded.columns).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
    await expect.poll(async () => Math.round((await page.locator("#desktop-sidebar").boundingBox())!.width)).toBe(80);
    const collapsed = await comfortableColumns(page, pointer.minimum);
    expect(collapsed.width).toBeGreaterThan(expanded.width);
    expect(collapsed.columns).toBeGreaterThanOrEqual(expanded.columns);
    for (const width of [1280, 1100, 1024]) {
      await page.setViewportSize({ width, height: 633 });
      await comfortableColumns(page, pointer.minimum);
    }
    await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
    await expect.poll(async () => Math.round((await page.locator("#desktop-sidebar").boundingBox())!.width)).toBe(224);
    await comfortableColumns(page, pointer.minimum);
  } finally { await context.close(); }
});
