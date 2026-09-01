<?xml version="1.0" encoding="UTF-8"?>
<sld:StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>swl_pipe_lm</sld:Title>
      <sld:Abstract>A layer style of swl_pipe_lm</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>swl_pipe_lm_stroke</ogc:Literal>
                    <ogc:Literal>673AB7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_stroke_width</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:PointSymbolizer>
            <sld:Geometry>
              <ogc:Function name="endPoint">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Geometry>
            <sld:Graphic>
              <sld:Mark>
                <sld:WellKnownName>shape://oarrow</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">
                    <ogc:Function name="strConcat">
                      <ogc:Literal>#</ogc:Literal>
                      <ogc:Function name="env">
                        <ogc:Literal>swl_pipe_lm_stroke</ogc:Literal>
                        <ogc:Literal>673AB7</ogc:Literal>
                      </ogc:Function>
                    </ogc:Function>
                  </sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>16</sld:Size>
              <sld:Rotation>
                <ogc:Function name="endAngle">
                  <ogc:PropertyName>geom</ogc:PropertyName>
                </ogc:Function>
              </sld:Rotation>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>FTR_IDN</ogc:Literal>
                  <ogc:Literal>pip_lbl</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>5</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>2</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#673AB7</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>swl_pipe_lm_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="goodnessOfFit">0</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>
