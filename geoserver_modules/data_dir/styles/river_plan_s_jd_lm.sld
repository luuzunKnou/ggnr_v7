<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0.0</sld:CssParameter>
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
          <sld:PointSymbolizer>
            <sld:Geometry>
              <ogc:Function name="startPoint">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Geometry>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="river_plan_jd_lm_capline.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
              <sld:Rotation>
                <ogc:Function name="startAngle">
                  <ogc:PropertyName>geom</ogc:PropertyName>
                </ogc:Function>
              </sld:Rotation>
              <sld:AnchorPoint>
                <sld:AnchorPointX>0.5</sld:AnchorPointX>
                <sld:AnchorPointY>0.5</sld:AnchorPointY>
              </sld:AnchorPoint>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:PointSymbolizer>
            <sld:Geometry>
              <ogc:Function name="endPoint">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Geometry>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="river_plan_jd_lm_capline.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
              <sld:Rotation>
                <ogc:Function name="endAngle">
                  <ogc:PropertyName>geom</ogc:PropertyName>
                </ogc:Function>
              </sld:Rotation>
              <sld:AnchorPoint>
                <sld:AnchorPointX>0.5</sld:AnchorPointX>
                <sld:AnchorPointY>0.5</sld:AnchorPointY>
              </sld:AnchorPoint>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

