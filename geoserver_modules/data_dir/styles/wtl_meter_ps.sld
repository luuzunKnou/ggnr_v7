<?xml version='1.0' encoding='UTF-8'?>
<sld:StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>wtl_meter_ps</sld:Title>
      <sld:Abstract>A layer style of wtl_meter_ps</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <sld:MaxScaleDenominator>3000</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:Mark>
                <sld:WellKnownName>
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_meter_ps_well_known_name</ogc:Literal>
                    <ogc:Literal>circle</ogc:Literal>
                  </ogc:Function>
                </sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">
                    <ogc:Function name="strConcat">
                      <ogc:Literal>#</ogc:Literal>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_meter_ps_fill</ogc:Literal>
                        <ogc:Literal>16a5a5</ogc:Literal>
                      </ogc:Function>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="fill-opacity">
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_meter_ps_fill_opacity</ogc:Literal>
                      <ogc:Literal>1</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                </sld:Fill>
                <sld:Stroke>
                  <sld:CssParameter name="stroke">
                    <ogc:Function name="strConcat">
                      <ogc:Literal>#</ogc:Literal>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_meter_ps_stroke</ogc:Literal>
                        <ogc:Literal>0c797d</ogc:Literal>
                      </ogc:Function>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="stroke-width">
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_meter_ps_stroke_width</ogc:Literal>
                      <ogc:Literal>1</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                </sld:Stroke>
              </sld:Mark>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_meter_ps_size</ogc:Literal>
                      <ogc:Literal>0</ogc:Literal>
                    </ogc:Function>
                    <ogc:Literal>0</ogc:Literal>
                  </ogc:Function>
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_meter_ps_size</ogc:Literal>
                    <ogc:Literal>16</ogc:Literal>
                  </ogc:Function>
                  <ogc:Function name="Categorize">
                    <ogc:Function name="env">
                      <ogc:Literal>wms_scale_denominator</ogc:Literal>
                    </ogc:Function>
                    <ogc:Literal>14</ogc:Literal>
                    <ogc:Literal>800</ogc:Literal>
                    <ogc:Literal>10</ogc:Literal>
                    <ogc:Literal>1500</ogc:Literal>
                    <ogc:Literal>8</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_meter_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_meter_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">normal</sld:CssParameter>
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
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_meter_ps_label_color</ogc:Literal>
                    <ogc:Literal>16a5a5</ogc:Literal>
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