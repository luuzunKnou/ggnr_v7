<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:MaxScaleDenominator>67907.80764496817</sld:MaxScaleDenominator>
          <sld:PolygonSymbolizer>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
              <sld:CssParameter name="fill-opacity">0.0</sld:CssParameter>
            </sld:Fill>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#5aa8cf</sld:CssParameter>
              <sld:CssParameter name="stroke-width">3</sld:CssParameter>
            </sld:Stroke>
          </sld:PolygonSymbolizer>
          <sld:TextSymbolizer>
            <sld:Geometry>
              <ogc:Function name="centroid">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Geometry>
            <sld:Label>
              <ogc:Function name="parseInt">
                <ogc:Function name="strSubstring">
                  <ogc:PropertyName>cons_code</ogc:PropertyName>
                  <ogc:Sub>
                    <ogc:Function name="strLength">
                      <ogc:PropertyName>cons_code</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>3</ogc:Literal>
                  </ogc:Sub>
                  <ogc:Function name="strLength">
                    <ogc:PropertyName>cons_code</ogc:PropertyName>
                  </ogc:Function>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Yu Gothic Bold</sld:CssParameter>
              <sld:CssParameter name="font-size">18</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>2</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
                <sld:CssParameter name="fill-opacity">0.8</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#3D7FA0</sld:CssParameter>
            </sld:Fill>
            <sld:Priority>
              <ogc:Function name="Area">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
            <sld:VendorOption name="group">false</sld:VendorOption>
            <sld:VendorOption name="maxDisplacement">120</sld:VendorOption>
            <sld:VendorOption name="goodnessOfFit">0</sld:VendorOption>
            <sld:VendorOption name="polygonAlign">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:MinScaleDenominator>67907.80764496817</sld:MinScaleDenominator>
          <sld:PolygonSymbolizer>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
              <sld:CssParameter name="fill-opacity">0.0</sld:CssParameter>
            </sld:Fill>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#5aa8cf</sld:CssParameter>
              <sld:CssParameter name="stroke-width">3</sld:CssParameter>
            </sld:Stroke>
          </sld:PolygonSymbolizer>
        </sld:Rule>
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

