<?xml version='1.0' encoding='UTF-8'?>
<sld:StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>cwtl_pipe_lm</sld:Title>
      <sld:Abstract>A layer style of cwtl_pipe_lm</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:PropertyIsLessThanOrEqualTo>
              <ogc:PropertyName>pip_dip</ogc:PropertyName>
              <ogc:Literal>100</ogc:Literal>
            </ogc:PropertyIsLessThanOrEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_stroke</ogc:Literal>
                    <ogc:Literal>FE6100</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_linecap</ogc:Literal>
                  <ogc:Literal>round</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_opacity</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_width</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
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
                <sld:WellKnownName>
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_well_known_name</ogc:Literal>
                    <ogc:Literal>shape://oarrow</ogc:Literal>
                  </ogc:Function>
                </sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">
                    <ogc:Function name="strConcat">
                      <ogc:Literal>#</ogc:Literal>
                      <ogc:Function name="env">
                        <ogc:Literal>cwtl_pipe_lm_fill</ogc:Literal>
                        <ogc:Literal>FE6100</ogc:Literal>
                      </ogc:Function>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="fill-opacity">
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_fill_opacity</ogc:Literal>
                      <ogc:Literal>1</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                </sld:Fill>
                <sld:Stroke>
                  <sld:CssParameter name="stroke">
                    <ogc:Function name="strConcat">
                      <ogc:Literal>#</ogc:Literal>
                      <ogc:Function name="env">
                        <ogc:Literal>cwtl_pipe_lm_stroke</ogc:Literal>
                        <ogc:Literal>FE6100</ogc:Literal>
                      </ogc:Function>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="stroke-opacity">
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_stroke_opacity</ogc:Literal>
                      <ogc:Literal>1</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="stroke-width">
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_stroke_width</ogc:Literal>
                      <ogc:Literal>1</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                </sld:Stroke>
              </sld:Mark>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_size</ogc:Literal>
                      <ogc:Literal>0</ogc:Literal>
                    </ogc:Function>
                    <ogc:Literal>0</ogc:Literal>
                  </ogc:Function>
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_size</ogc:Literal>
                  </ogc:Function>
                  <ogc:Function name="Categorize">
                    <ogc:Function name="env">
                      <ogc:Literal>wms_scale_denominator</ogc:Literal>
                    </ogc:Function>
                    <ogc:Literal>20</ogc:Literal>
                    <ogc:Literal>1500</ogc:Literal>
                    <ogc:Literal>16</ogc:Literal>
                    <ogc:Literal>3000</ogc:Literal>
                    <ogc:Literal>14</ogc:Literal>
                    <ogc:Literal>5000</ogc:Literal>
                    <ogc:Literal>6</ogc:Literal>
                    <ogc:Literal>10000</ogc:Literal>
                    <ogc:Literal>5</ogc:Literal>
                    <ogc:Literal>30000</ogc:Literal>
                    <ogc:Literal>4</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:Size>
              <sld:Rotation>
                <ogc:Function name="endAngle">
                  <ogc:PropertyName>geom</ogc:PropertyName>
                </ogc:Function>
              </sld:Rotation>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsLessThanOrEqualTo>
                <ogc:PropertyName>pip_dip</ogc:PropertyName>
                <ogc:Literal>100</ogc:Literal>
              </ogc:PropertyIsLessThanOrEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                    <ogc:Literal>pip_lbl</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                  <ogc:Literal>pip_lbl</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>5</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_label_halo_color</ogc:Literal>
                      <ogc:Literal>FFFFFF</ogc:Literal>
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
                    <ogc:Literal>cwtl_pipe_lm_label_color</ogc:Literal>
                    <ogc:Literal>E98D44</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:PropertyIsLessThanOrEqualTo>
              <ogc:PropertyName>pip_dip</ogc:PropertyName>
              <ogc:Literal>100</ogc:Literal>
            </ogc:PropertyIsLessThanOrEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_stroke</ogc:Literal>
                    <ogc:Literal>FE6100</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_linecap</ogc:Literal>
                  <ogc:Literal>round</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_opacity</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_width</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_dasharray</ogc:Literal>
                  <ogc:Literal>5 10</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsLessThanOrEqualTo>
                <ogc:PropertyName>pip_dip</ogc:PropertyName>
                <ogc:Literal>100</ogc:Literal>
              </ogc:PropertyIsLessThanOrEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                    <ogc:Literal>pip_lbl</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                  <ogc:Literal>pip_lbl</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>5</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_label_halo_color</ogc:Literal>
                      <ogc:Literal>FFFFFF</ogc:Literal>
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
                    <ogc:Literal>cwtl_pipe_lm_label_color</ogc:Literal>
                    <ogc:Literal>E98D44</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>pip_dip</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:PropertyIsGreaterThan>
              <ogc:PropertyName>pip_dip</ogc:PropertyName>
              <ogc:Literal>100</ogc:Literal>
            </ogc:PropertyIsGreaterThan>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_stroke</ogc:Literal>
                    <ogc:Literal>FE6100</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_linecap</ogc:Literal>
                  <ogc:Literal>round</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_opacity</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_width</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>pip_dip</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsGreaterThan>
                <ogc:PropertyName>pip_dip</ogc:PropertyName>
                <ogc:Literal>100</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                    <ogc:Literal>pip_lbl</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                  <ogc:Literal>pip_lbl</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>5</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_label_halo_color</ogc:Literal>
                      <ogc:Literal>FFFFFF</ogc:Literal>
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
                    <ogc:Literal>cwtl_pipe_lm_label_color</ogc:Literal>
                    <ogc:Literal>E98D44</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>pip_dip</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:PropertyIsGreaterThan>
              <ogc:PropertyName>pip_dip</ogc:PropertyName>
              <ogc:Literal>100</ogc:Literal>
            </ogc:PropertyIsGreaterThan>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_stroke</ogc:Literal>
                    <ogc:Literal>FE6100</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_linecap</ogc:Literal>
                  <ogc:Literal>round</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_opacity</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_width</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_stroke_dasharray</ogc:Literal>
                  <ogc:Literal>5 10</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>pip_dip</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsGreaterThan>
                <ogc:PropertyName>pip_dip</ogc:PropertyName>
                <ogc:Literal>100</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                    <ogc:Literal>pip_lbl</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_property_name</ogc:Literal>
                  <ogc:Literal>pip_lbl</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>5</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>cwtl_pipe_lm_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>cwtl_pipe_lm_label_halo_color</ogc:Literal>
                      <ogc:Literal>FFFFFF</ogc:Literal>
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
                    <ogc:Literal>cwtl_pipe_lm_label_color</ogc:Literal>
                    <ogc:Literal>E98D44</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>