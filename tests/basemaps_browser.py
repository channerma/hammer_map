"""Headless Chromium: switch to each basemap of js/basemaps.js, count its tiles and errors, check keys, overlay, offline sheet.

Run from the repository root (needs uv and a network):
    uv run --no-project --with playwright==1.64.0 --with pillow python -I tests/basemaps_browser.py . /tmp/basemaps_out
(first time: uv run --no-project --with playwright==1.64.0 playwright install chromium)
"""
import io, json, subprocess, sys, time
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
root, out = sys.argv[1], Path(sys.argv[2])
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8798", "--bind", "127.0.0.1", "--directory", root],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
POLL = "() => new Promise((r) => { const t0 = Date.now(); const f = () => { const u = hmMap.getSource('bm-carto-light').tiles[0]; if (Date.now() - t0 > 4000 || WANT(u)) r(u); else setTimeout(f, 100); }; f(); })"
IDLE = "() => new Promise((r) => { const t = setTimeout(() => r('timeout'), 25000); hmMap.once('idle', () => { clearTimeout(t); r('idle'); }); })"
def colors(png):
    im = Image.open(io.BytesIO(png)).convert("RGB").resize((128, 128))
    return len(set(im.get_flattened_data()))
errors = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 390, "height": 844})
        pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        pg.goto("http://127.0.0.1:8798/", wait_until="load")
        pg.wait_for_selector("body[data-ready='1']", timeout=40000)
        pg.evaluate("""() => { window.__t = {}; window.__e = [];
          hmMap.on('sourcedata', (e) => { if (e.tile && e.sourceId?.startsWith('bm-')) __t[e.sourceId] = (__t[e.sourceId] || 0) + 1; });
          hmMap.on('error', (e) => __e.push({ src: e.sourceId || null, msg: String(e.error?.message || e.error).slice(0, 120) })); }""")
        for k in ["padus", "smaWest", "claimsOpen", "claimsClosed"]:
            pg.evaluate(f"() => hmActions.setLayer('{k}', false)")
        shown = pg.evaluate("async () => (await import('./js/basemaps.js')).SHOWN_BASEMAPS.map((b) => ({ id: b.id, key: b.key || null }))")
        rows = []
        for bm in shown:
            if bm["key"]:
                continue
            ll = "[106.70, 10.78]" if bm["id"] == "hcmc-onemap" else "[-84.27, 36.01]"
            z = 6 if bm["id"] == "esri-physical" else 12
            pg.evaluate(f"() => {{ hmActions.setBasemap('{bm['id']}'); hmMap.jumpTo({{ center: {ll}, zoom: {z} }}); }}")
            st = pg.evaluate(IDLE)
            src = f"bm-{bm['id']}"
            n = pg.evaluate(f"() => __t['{src}'] || 0")
            errs = pg.evaluate(f"() => __e.filter((e) => e.src === '{src}').length")
            vis = pg.evaluate(f"() => hmMap.getLayoutProperty('{src}', 'visibility')")
            attr = pg.evaluate("() => document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent || ''")
            png = pg.locator("#map").screenshot()
            (out / f"{bm['id']}.png").write_bytes(png)
            rows.append({"id": bm["id"], "state": st, "tiles": n, "errors": errs, "visible": vis, "colors": colors(png), "attribution": attr[:70]})
        for r in rows:
            print(json.dumps(r))
        # overlay on imagery
        pg.evaluate("() => { hmActions.setBasemap('esri-imagery'); hmActions.setLayer('places', true); hmMap.jumpTo({ center: [-84.27, 36.01], zoom: 11 }); }")
        print("overlay", pg.evaluate(IDLE), "tiles", pg.evaluate("() => __t['bm-esri-places'] || 0"), "errors", pg.evaluate("() => __e.filter((e) => e.src === 'bm-esri-places').length"))
        (out / "imagery-places.png").write_bytes(pg.locator("#map").screenshot())
        # CARTO key path (a made-up key: only the URL is checked, CARTO is not asked to accept it)
        print("carto before", pg.evaluate("() => hmMap.getSource('bm-carto-light').tiles[0]"))
        pg.evaluate("() => hmActions.setKey('carto', 'TESTKEY123')")
        print("carto with key", pg.evaluate(POLL.replace('WANT(u)', "u.includes('key=')")), "| state", pg.evaluate("() => hmState.keys"))
        pg.evaluate("() => hmActions.setKey('carto', '')")
        print("carto removed", pg.evaluate(POLL.replace('WANT(u)', "!u.includes('key=')")), "| state", pg.evaluate("() => hmState.keys"))
        # offline: an online-only basemap is not planned
        pg.evaluate("() => hmOffline.openSheet()")
        pg.wait_for_selector(".offline", timeout=10000)
        print("offline check:", pg.locator(".offline .checks label").first.inner_text(), "| disabled", pg.locator(".offline input[name=basemap]").is_disabled())
        plans = pg.evaluate("async () => (await hmOffline.plan(hmOffline.viewBounds(), { basemap: true, maxZoom: 12 })).map((p) => p.key)")
        print("offline plan keys with esri-imagery:", plans)
        pg.evaluate("() => hmActions.setBasemap('topo')")
        plans2 = pg.evaluate("async () => (await hmOffline.plan(hmOffline.viewBounds(), { basemap: true, maxZoom: 12 })).map((p) => p.key)")
        print("offline plan keys with USGS topo:", plans2)
        # layers sheet for a screenshot, with the imagery chosen
        pg.evaluate("() => { hmActions.setBasemap('esri-imagery'); hmState.basemap = 'esri-imagery'; }")
        pg.click("#sheet-close")
        pg.wait_for_timeout(500)
        pg.click("#btn-layers")
        pg.wait_for_selector(".layers", timeout=10000)
        print("chips", pg.locator(".layers input[name=basemap]").count(), "| disabled", pg.locator(".layers input[name=basemap]:disabled").count())
        pg.screenshot(path=str(out / "layers-sheet.png"))
        print("page errors", errors, "| all map errors", pg.evaluate("() => __e"))
        b.close()
finally:
    srv.terminate()
