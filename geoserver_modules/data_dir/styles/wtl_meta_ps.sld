<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_meta_ps.png"/>
                <sld:Format>image/png</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="min">
                  <ogc:Literal>18</ogc:Literal>
                  <ogc:Add>
                    <ogc:Literal>5</ogc:Literal>
                    <ogc:Mul>
                      <ogc:Function name="sqrt">
                        <ogc:Div>
                          <ogc:Literal>100000</ogc:Literal>
                          <ogc:Function name="env">
                            <ogc:Literal>wms_scale_denominator</ogc:Literal>
                            <ogc:Literal>10000</ogc:Literal>
                          </ogc:Function>
                        </ogc:Div>
                      </ogc:Function>
                      <ogc:Literal>4.0</ogc:Literal>
                    </ogc:Mul>
                  </ogc:Add>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

