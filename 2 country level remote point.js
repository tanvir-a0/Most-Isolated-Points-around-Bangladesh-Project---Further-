/**** PART 2: distance to nearest building, and the max ****/

var SCALE = 100;
var ASSET = 'projects/xxxxxx/assets/bgd_built_100m';

var bgd  = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
             .filter(ee.Filter.eq('country_na', 'Bangladesh'));
var geom = bgd.geometry();

var built = ee.Image(ASSET).unmask(0);

// Squared distance in pixels -> metres. 400 px = 40 km search cap.
var distM = built.fastDistanceTransform({neighborhood: 400, units: 'pixels'})
                 .sqrt().multiply(SCALE).rename('dist_m');

// --- optional: exclude open water ---
// JRC occurrence > 80 means water present >80% of the time
var WATER_MASK = false;
if (WATER_MASK) {
  var perm = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').gt(80).unmask(0);
  distM = distM.updateMask(perm.not());
}

distM = distM.clip(geom);

Map.centerObject(geom, 7);
Map.addLayer(distM, {min: 0, max: 15000,
             palette: ['000080','0080ff','00ffff','ffff00','ff8000','ff0000']},
             'distance to nearest building (m)');

// max(3): max of band 1, plus the values of bands 2 and 3 at that same pixel
var stack = distM.addBands(ee.Image.pixelLonLat());

var result = stack.reduceRegion({
  reducer: ee.Reducer.max(3),
  geometry: geom,
  scale: SCALE,
  crs: 'EPSG:4326',
  maxPixels: 1e13,
  bestEffort: false
});

print('raw result:', result);

var dist = ee.Number(result.get('max'));
var lon  = ee.Number(result.get('max1'));
var lat  = ee.Number(result.get('max2'));

print('Max distance to nearest building (m):', dist);
print('Longitude:', lon);
print('Latitude:',  lat);

var pt = ee.Geometry.Point([lon, lat]);
Map.addLayer(pt, {color: 'lime'}, 'most remote point');
print('Google Maps link:',
      ee.String('https://www.google.com/maps/search/?api=1&query=')
        .cat(lat.format('%.5f')).cat(',').cat(lon.format('%.5f')));

var permTest = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
                 .select('occurrence').gt(80).unmask(0);

var waterCount = permTest.reduceRegion({
  reducer: ee.Reducer.sum(),
  geometry: geom,
  scale: 500,
  maxPixels: 1e13
});

print(waterCount);


/**** NEW: circle of minimum distance + line to the nearest building ****/

// Candidate buildings near the remote point, tagged with true geodesic distance
var near = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
             .filterBounds(pt.buffer(15000))
             .filter(ee.Filter.gte('confidence', 0.65))
             .map(function(f) {
               return f.set('d', f.geometry().distance(pt, 1));
             });

var nearest  = ee.Feature(near.sort('d').first());
var trueDist = ee.Number(nearest.get('d'));

print('true nearest distance (m):', trueDist);
print('raster vs true difference (m):', dist.subtract(trueDist));

// Circle centred on the remote point, radius = true nearest distance
var circle = ee.Feature(pt.buffer(trueDist));
Map.addLayer(ee.FeatureCollection([circle])
  .style({color: 'ff0000', fillColor: '00000000', width: 2}), {}, 'minimum radius');

// Straight line from the remote point out to that building
var target = nearest.geometry().centroid(1);
var line   = ee.Feature(ee.Geometry.LineString([pt.coordinates(), target.coordinates()]));
Map.addLayer(ee.FeatureCollection([line])
  .style({color: 'ffff00', width: 2}), {}, 'line to nearest building');

// The winning building itself
Map.addLayer(ee.FeatureCollection([nearest])
  .style({color: '00ff00', fillColor: '00ff0099', width: 1}), {}, 'nearest building');

Map.centerObject(circle, 12);