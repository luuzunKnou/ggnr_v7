<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>wtl_tank_ps</sld:Title>
      <sld:Abstract>A layer style of wtl_tank_ps</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>wtl_tank_ps</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_rsrv_ps.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="env">
                  <ogc:Literal>Default Styler_size</ogc:Literal>
                  <ogc:Literal>16</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>wtl_tank_ps_label</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:PropertyIsGreaterThan>
              <ogc:Function name="strLength">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_tank_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
              <ogc:Literal>0</ogc:Literal>
            </ogc:PropertyIsGreaterThan>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_tank_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Dotum</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_tank_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_tank_ps_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>1.0</sld:AnchorPointY>
                </sld:AnchorPoint>
                <sld:Displacement>
                  <sld:DisplacementX>0</sld:DisplacementX>
                  <sld:DisplacementY>-10</sld:DisplacementY>
                </sld:Displacement>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>wtl_tank_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_tank_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal/>
                    </ogc:Function>
                  </ogc:Function>
                </sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_tank_ps_label_color</ogc:Literal>
                    <ogc:Literal/>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>