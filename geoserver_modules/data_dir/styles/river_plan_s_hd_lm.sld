<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:MaxScaleDenominator>16976.95191124199</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">3</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#e91e63</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:TextSymbolizer>
            <sld:Geometry>
              <ogc:Function name="centroid">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Geometry>
            <sld:Label>
              <ogc:PropertyName>draw_name</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Yu Gothic Bold</sld:CssParameter>
              <sld:CssParameter name="font-size">11</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
                <sld:Rotation>
                  <ogc:Add>
                    <ogc:Function name="startAngle">
                      <ogc:PropertyName>geom</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>180</ogc:Literal>
                  </ogc:Add>
                </sld:Rotation>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>2</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
                <sld:CssParameter name="fill-opacity">0.85</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#000000</sld:CssParameter>
            </sld:Fill>
            <sld:Priority>1000000</sld:Priority>
            <sld:VendorOption name="followLine">false</sld:VendorOption>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
            <sld:VendorOption name="group">false</sld:VendorOption>
            <sld:VendorOption name="maxDisplacement">120</sld:VendorOption>
            <sld:VendorOption name="goodnessOfFit">0</sld:VendorOption>
            <sld:VendorOption name="polygonAlign">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:MinScaleDenominator>16976.95191124199</sld:MinScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">3</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#e91e63</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

