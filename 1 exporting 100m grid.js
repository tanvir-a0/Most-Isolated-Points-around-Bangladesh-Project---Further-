/**** PART 1 (V3 polygons): build the 100 m building mask ****/

var SCALE  = 100;
var BUFFER = 30000;
var CONF   = 0.65;   // Google's suggested high-precision threshold

var bgd  = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
            .filter(ee.Filter.eq('country_na', 'Bangladesh'));
var geom = bgd.geometry();
var aoi  = geom.buffer(BUFFER);

var obv3 = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
            .filterBounds(aoi)
            .filter(ee.Filter.gte('confidence', CONF));

// Rasterize: any cell containing a footprint becomes 1.
// 'confidence' is always > 0, so .gt(0) gives a clean binary mask.
var built = obv3.reduceToImage({
      properties: ['confidence'],
      reducer: ee.Reducer.max()
    }).gt(0).unmask(0).rename('built');

Map.centerObject(geom, 7);
Map.addLayer(bgd.style({color:'yellow', fillColor:'00000000', width:2}), {}, 'Bangladesh');

Export.image.toAsset({
  image: built.toByte(),
  description: 'bgd_built_100m',
  assetId: 'bgd_built_100m',
  region: aoi,
  scale: SCALE,
  crs: 'EPSG:4326',
  maxPixels: 1e10
});