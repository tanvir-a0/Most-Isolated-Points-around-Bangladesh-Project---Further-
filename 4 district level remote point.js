/**** PART 4: most remote point per district (ADM2), with image export
 *
 * For each district it finds the point furthest from any building,
 * measures the true distance to the nearest Open Buildings footprint,
 * and exports a picture of the district showing:
 *   - the district outline
 *   - the remote point
 *   - the circle of empty radius around it
 *   - the line from the point to the nearest building
 *   - the nearest building itself
 *
 * Images go to the Drive folder set in DRIVE_FOLDER below.
 *
 * TEST FIRST: leave TEST_DISTRICT set to a single district name, check the
 * exported image, then set TEST_DISTRICT = null to run all 64 districts.
 *
 * A region in Sunamganj is excluded via the GAPS collection below.
 * Open Buildings V3 has no detections there at any confidence level,
 * but satellite imagery clearly shows villages — see the "Known
 * limitations" section of the README.
 ****/

// python "tif_to_image.py" "E:/TanvirAhmed Desktop My-Doc/Desktop/Remote Point of Bangladesh/Project_Further" --fmt jpg

// ---------------- settings ----------------

var SCALE     = 100;
var ASSET     = 'projects/xxxxxx/assets/bgd_built_100m';
var ADM_ASSET = 'projects/xxxxxx/assets/data_for_adm03_bangladesh';
var CONF      = 0.65;

var WATER_MASK   = false;   // true = winning point must be on non-permanent-water
var EXCLUDE_GAPS = true;    // true = ignore known V3 data-gap regions

// Run one district first. Set to null to export every district.
var TEST_DISTRICT = null;   // a district name runs just that one; null runs all

// Drive destination: GEE_Exports/Project_Further
// Earth Engine does not take a path here — it matches a folder by NAME at any
// depth, so the leaf name is what goes in. Do not write the full path.
// Caveat: if a second folder called Project_Further ever exists elsewhere in
// Drive, exports go to whichever was modified most recently.
var DRIVE_FOLDER = 'Project_Further';

var IMG_SCALE   = 20;       // metres per pixel for the district overview
var ZOOM_SCALE  = 10;       // metres per pixel for the close-up (S2 native = 10)

// Two pictures are exported per district, so two tasks each. Turn either off.
var OVERVIEW_EXPORT = false; // whole district, wide context
var ZOOM_EXPORT     = true;  // close-up around the remote point

// Direct PNG link, printed in the console - no task, no Drive, no GeoTIFF.
// Same pixels as the export and ready in seconds, so this is the cheap way to
// check a district. For all 64 the Drive tasks are easier: start them and
// walk away, rather than clicking 64 links.
var PRINT_PNG  = false;
var PNG_MAX_PX = 2000;      // longest side; the thumbnail service caps the size

// Per-district map layers are for inspecting one district, not all 64.
var DRAW_LAYERS = TEST_DISTRICT !== null;

// Line widths are in PIXELS OF THE EXPORTED IMAGE, not metres. On a 4000 px
// GeoTIFF a 3 px line is a hairline and disappears when a viewer scales the
// image down. Raise these if features are hard to see; lower them if the
// overlay swamps the imagery.
var W_DISTRICT = 6;
var W_CIRCLE   = 8;
var W_LINE     = 8;
var W_BUILDING = 4;
var SZ_POINT   = 20;        // point marker diameter, also in pixels

// Radius in METRES of the ring drawn around the nearest building. A single
// house is roughly one pixel at 10 m/px and would otherwise be invisible;
// this makes it findable. Scale it with ZOOM_MARGIN if you change the framing.
var HALO_M = 250;

// How much ground the close-up covers, as a multiple of the circle radius.
// This is the zoom control: bigger = wider view, circle looks smaller.
// 1.2 = the circle just fits; 2.4 = circle fills half the frame, with
// surrounding villages visible for context.
var ZOOM_MARGIN = 2.4;
var MAX_PIXELS  = 1e9;

// Sentinel-2 background
var S2_START = '2023-11-01';   // dry season = fewer clouds over Bangladesh
var S2_END   = '2024-03-31';
var S2_VIS   = {bands: ['B4', 'B3', 'B2'], min: 200, max: 2500, gamma: 1.2};

// overlay colours
var C_DISTRICT = 'ffffff';
var C_CIRCLE   = 'ff2d2d';
var C_LINE     = 'ffd400';
var C_POINT    = 'ff2d2d';
var C_BUILDING = '00ff66';

// --- known Open Buildings V3 data gaps (confirmed by imagery) ---
var GAPS = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Polygon(
    [[[91.47150831277732, 25.13809886947831],
      [91.47150831277732, 25.079342514697572],
      [91.64557294900779, 25.079342514697572],
      [91.64557294900779, 25.13809886947831]]], null, false),
    {note: 'Sunamganj tile gap'})
]);

// ---------------- distance surface ----------------

var built = ee.Image(ASSET).unmask(0);

var distM = built.fastDistanceTransform({neighborhood: 400, units: 'pixels'})
                 .sqrt().multiply(SCALE).rename('dist_m');

if (WATER_MASK) {
  var perm = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
               .select('occurrence').gt(80).unmask(0);
  distM = distM.updateMask(perm.not());
}

if (EXCLUDE_GAPS) {
  var gapMask = ee.Image(0).byte().paint(GAPS, 1);
  distM = distM.updateMask(gapMask.not());
}

var stack = distM.addBands(ee.Image.pixelLonLat());

// ---------------- inputs ----------------

var ADM = ee.FeatureCollection(ADM_ASSET);

var OB = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
           .filter(ee.Filter.gte('confidence', CONF));

// Sentinel-2 background, built once and reused by every export.
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
           .filterDate(S2_START, S2_END)
           .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
           .median()
           .visualize(S2_VIS);

// Only reduce the upazilas we actually need.
var work = ADM;
if (TEST_DISTRICT) {
  work = ADM.filter(ee.Filter.eq('ADM2_EN', TEST_DISTRICT));
  print('TEST MODE — district:', TEST_DISTRICT);
  print('upazilas matched (0 means the name is spelled differently):', work.size());
}

// --- max per upazila, carrying the winning pixel's coordinates ---
var perUpazila = stack.reduceRegions({
  collection: work,
  reducer: ee.Reducer.max(3),
  scale: SCALE,
  crs: 'EPSG:4326'
});

// ---------------- map preview ----------------

Map.setCenter(90.35, 23.7, 7);
Map.addLayer(distM, {min: 0, max: 9600,
             palette: ['000080','0080ff','00ffff','ffff00','ff8000','ff0000']},
             'distance to nearest building (m)', false);
Map.addLayer(GAPS.style({color: 'ff00ff', fillColor: '00000000', width: 2}),
             {}, 'excluded gaps', false);

// ---------------- per district: draw and export ----------------

perUpazila
  .select(['ADM1_EN', 'ADM2_EN', 'ADM3_EN', 'max', 'max1', 'max2'], null, false)
  .evaluate(function(fc, err) {
    if (err) { print('evaluate error:', err); return; }
    if (!fc || !fc.features.length) { print('no features returned'); return; }

    // keep the best upazila in each district
    var best = {};
    fc.features.forEach(function(f) {
      var p = f.properties;
      if (p.max === null || p.max === undefined) return;
      var d = p.ADM2_EN;
      if (!best[d] || p.max > best[d].max) { best[d] = p; }
    });

    var names = Object.keys(best).sort();
    print('districts to export:', names.length);

    names.forEach(function(dist) {
      var p = best[dist];

      var pt = ee.Geometry.Point([p.max1, p.max2]);

      // true distance to the nearest footprint, not the 100 m grid distance
      var near = OB.filterBounds(pt.buffer(25000))
                   .map(function(f) { return f.set('d', f.geometry().distance(pt, 1)); });

      var nearest  = ee.Feature(near.sort('d').first());
      var trueDist = ee.Number(nearest.get('d'));

      var circle = ee.Feature(pt.buffer(trueDist));
      var line   = ee.Feature(ee.Geometry.LineString(
                     [pt.coordinates(), nearest.geometry().centroid(1).coordinates()]));

      var districtGeom = ADM.filter(ee.Filter.eq('ADM2_EN', dist)).geometry();
      var outline = ee.Feature(districtGeom);

      // --- build the picture: Sentinel-2 with the vectors blended on top ---
      // A rural house is about one pixel at 10 m/px, and the line ends right on
      // top of it, so the building needs a ring around it to be findable and
      // must be drawn AFTER the line or the line paints over it.
      var halo = ee.Feature(nearest.geometry().centroid(1).buffer(HALO_M));

      var overlay = s2
        .blend(ee.FeatureCollection([outline]).style(
                 {color: C_DISTRICT, fillColor: '00000000', width: W_DISTRICT}))
        .blend(ee.FeatureCollection([circle]).style(
                 {color: C_CIRCLE, fillColor: '00000000', width: W_CIRCLE}))
        .blend(ee.FeatureCollection([line]).style(
                 {color: C_LINE, width: W_LINE}))
        .blend(ee.FeatureCollection([halo]).style(
                 {color: C_BUILDING, fillColor: '00000000', width: W_BUILDING}))
        .blend(ee.FeatureCollection([nearest]).style(
                 {color: C_BUILDING, fillColor: C_BUILDING + 'cc', width: W_BUILDING}))
        .blend(ee.FeatureCollection([ee.Feature(pt)]).style(
                 {color: C_POINT, pointSize: SZ_POINT, width: 2}));

      var tag = (p.ADM1_EN + '_' + dist).replace(/[^A-Za-z0-9]+/g, '_')
                + '_' + Math.round(p.max) + 'm';

      // lat and lon of the remote point, decimal point written as '_' because
      // Earth Engine task descriptions reject most punctuation.
      // 4 decimals is ~11 m, enough to paste back into a map.
      var coords = '_' + p.max2.toFixed(4).replace(/[.-]/g, '_')
                 + '_' + p.max1.toFixed(4).replace(/[.-]/g, '_');

      // overview: the whole district, plus the circle if it spills over the border
      if (OVERVIEW_EXPORT) {
        var overviewRegion = districtGeom.bounds()
                               .union(circle.geometry().bounds(), 100).bounds();

        Export.image.toDrive({
          image: overlay,
          description: 'p4_' + tag + '_overview' + coords,
          fileNamePrefix: 'p4_' + tag + '_overview' + coords,
          folder: DRIVE_FOLDER,
          region: overviewRegion,
          scale: IMG_SCALE,
          crs: 'EPSG:4326',
          maxPixels: MAX_PIXELS,
          fileFormat: 'GeoTIFF'
        });
      }

      // close-up around the remote point, for checking tangency
      if (ZOOM_EXPORT) {
        var zoomRegion = pt.buffer(trueDist.multiply(ZOOM_MARGIN).max(500)).bounds();
        Export.image.toDrive({
          image: overlay,
          description: 'p4_' + tag + '_zoom' + coords,
          fileNamePrefix: 'p4_' + tag + '_zoom' + coords,
          folder: DRIVE_FOLDER,
          region: zoomRegion,
          scale: ZOOM_SCALE,
          crs: 'EPSG:4326',
          maxPixels: MAX_PIXELS,
          fileFormat: 'GeoTIFF'
        });
      }

      // --- straight to PNG, no task needed ---
      if (PRINT_PNG) {
        var pngRegion = pt.buffer(trueDist.multiply(ZOOM_MARGIN).max(500)).bounds();
        overlay.getThumbURL({
          region: pngRegion,
          dimensions: PNG_MAX_PX,
          format: 'png'
        }, function (url, e) {
          if (e) { print('    png error (' + dist + '):', e); return; }
          print('    png: ' + 'p4_' + tag + '_zoom' + coords, url);
        });
      }

      // --- map layers, so you can eyeball it before running the tasks ---
      // Five layers per district would be 320 layers across all 64, which
      // hangs the Code Editor. Only draw them when checking a single district.
      if (DRAW_LAYERS) {
        Map.addLayer(overlay, {}, dist + ' — export preview', false);
        Map.addLayer(ee.FeatureCollection([circle])
          .style({color: C_CIRCLE, fillColor: '00000000', width: 2}), {}, dist + ' — radius');
        Map.addLayer(ee.FeatureCollection([line])
          .style({color: C_LINE, width: 2}), {}, dist + ' — line', false);
        Map.addLayer(ee.FeatureCollection([ee.Feature(pt)])
          .style({color: C_POINT, pointSize: 6}), {}, dist + ' — point');
        Map.addLayer(ee.FeatureCollection([nearest])
          .style({color: C_BUILDING, fillColor: C_BUILDING + '99', width: 1}),
          {}, dist + ' — nearest building', false);
      }

      print(p.ADM1_EN + ' | ' + dist + ' | ' + p.ADM3_EN
            + ' | raster ' + Math.round(p.max) + ' m'
            + ' | ' + p.max2.toFixed(5) + ', ' + p.max1.toFixed(5));
      print('    true nearest (m):', trueDist);
      print('    maps: https://www.google.com/maps/@' + p.max2 + ',' + p.max1 + ',14z/data=!3m1!1e3');

      if (TEST_DISTRICT) { Map.centerObject(circle, 12); }
    });

    print('Open the Tasks tab and click Run on each task.');
  });
