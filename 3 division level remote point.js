/**** PART 2b: most remote point per division (ADM1)
 *
 * A region in Sunamganj is excluded via the GAPS collection below.
 * Open Buildings V3 has no detections there at any confidence level,
 * but satellite imagery clearly shows villages — see the "Known
 * limitations" section of the README.
 ****/

var SCALE = 100;
var ASSET = 'projects/xxxxxx/assets/bgd_built_100m';
var ADM_ASSET = 'projects/xxxxxx/assets/data_for_adm03_bangladesh';
var CONF = 0.65;
var WATER_MASK = false;    // true = winning point must be on non-permanent-water
var EXCLUDE_GAPS = true;   // true = ignore known V3 data-gap regions

// --- known Open Buildings V3 data gaps (confirmed by imagery) ---
var GAPS = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Polygon(
    [[[91.47150831277732, 25.13809886947831],
      [91.47150831277732, 25.079342514697572],
      [91.64557294900779, 25.079342514697572],
      [91.64557294900779, 25.13809886947831]]], null, false),
    {note: 'Sunamganj tile gap'})
]);

// --- distance surface ---
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

// --- admin boundaries ---
var ADM = ee.FeatureCollection(ADM_ASSET);
print('one feature (check property names):', ADM.first());

var OB = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
           .filter(ee.Filter.gte('confidence', CONF));

// --- max per upazila, carrying the winning pixel's coordinates ---
var perUpazila = stack.reduceRegions({
  collection: ADM,
  reducer: ee.Reducer.max(3),
  scale: SCALE,
  crs: 'EPSG:4326'
});

Map.setCenter(90.35, 23.7, 7);
Map.addLayer(distM, {min: 0, max: 9600,
             palette: ['000080','0080ff','00ffff','ffff00','ff8000','ff0000']},
             'distance to nearest building (m)', false);
Map.addLayer(GAPS.style({color: 'ff00ff', fillColor: '00000000', width: 2}),
             {}, 'excluded gaps', false);

// --- pick the best upazila in each division, then draw ---
perUpazila
  .select(['ADM1_EN', 'ADM2_EN', 'ADM3_EN', 'max', 'max1', 'max2'], null, false)
  .evaluate(function(fc, err) {
    if (err) { print('evaluate error:', err); return; }

    var best = {};
    fc.features.forEach(function(f) {
      var p = f.properties;
      if (p.max === null || p.max === undefined) return;
      var div = p.ADM1_EN;
      if (!best[div] || p.max > best[div].max) { best[div] = p; }
    });

    var palette = ['ff0000','ff8000','ffcc00','00cc44','00e5ff','2f7fff','9933ff','ff33cc'];
    var i = 0;

    Object.keys(best).sort().forEach(function(div) {
      var p = best[div];
      var colour = palette[i % palette.length];
      i++;

      var pt = ee.Geometry.Point([p.max1, p.max2]);

      var near = OB.filterBounds(pt.buffer(25000))
                   .map(function(f) { return f.set('d', f.geometry().distance(pt, 1)); });

      var nearest  = ee.Feature(near.sort('d').first());
      var trueDist = ee.Number(nearest.get('d'));

      var circle = ee.Feature(pt.buffer(trueDist));
      var line   = ee.Feature(ee.Geometry.LineString(
                     [pt.coordinates(), nearest.geometry().centroid(1).coordinates()]));

      var label = div + ' (' + p.ADM3_EN + ', ' + Math.round(p.max) + ' m)';

      Map.addLayer(ee.FeatureCollection([circle])
        .style({color: colour, fillColor: '00000000', width: 2}), {}, label + ' — radius');
      Map.addLayer(ee.FeatureCollection([line])
        .style({color: colour, width: 2}), {}, label + ' — line', false);
      Map.addLayer(ee.FeatureCollection([ee.Feature(pt)])
        .style({color: colour, pointSize: 6}), {}, label + ' — point');
      Map.addLayer(ee.FeatureCollection([nearest])
        .style({color: '00ff00', fillColor: '00ff0099', width: 1}),
        {}, label + ' — nearest building', false);

      print(div + ' | ' + p.ADM3_EN + ' | raster ' + Math.round(p.max) + ' m'
            + ' | ' + p.max2.toFixed(5) + ', ' + p.max1.toFixed(5));
      print('    true nearest (m):', trueDist);
    });
  });