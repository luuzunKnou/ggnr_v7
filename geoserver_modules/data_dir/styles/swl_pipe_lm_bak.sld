<?xml version='1.0' encoding='UTF-8'?>
<sld:StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>swl_pipe_lm_bak</sld:Title>
      <sld:Abstract>A layer style of swl_pipe_lm_bak</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <sld:MinScaleDenominator>0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>3000</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>swl_pipe_lm_bak_stroke</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_stroke_linecap</ogc:Literal>
                  <ogc:Literal>round</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_stroke_opacity</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_stroke_width</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
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
            <ogc:PropertyIsGreaterThan>
              <ogc:Function name="strLength">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_property_name</ogc:Literal>
                  <ogc:Literal></ogc:Literal>
                </ogc:Function>
              </ogc:Function>
              <ogc:Literal>0</ogc:Literal>
            </ogc:PropertyIsGreaterThan>
          </ogc:Filter>
          <sld:MinScaleDenominator>0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>3000</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>00A396</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_first</sld:Name>
          <sld:MaxScaleDenominator>500.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>pip_lbl</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>17</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-38</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="allowOverlaps">true</sld:VendorOption>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
            <sld:VendorOption name="spaceAround">0</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_first</sld:Name>
          <sld:MaxScaleDenominator>500.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>L= <ogc:PropertyName>byc_len</ogc:PropertyName>  S= <ogc:PropertyName>pip_slp</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>17</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-17</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="allowOverlaps">true</sld:VendorOption>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
            <sld:VendorOption name="spaceAround">0</sld:VendorOption>
            <sld:VendorOption name="maxDisplacement">50</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_first</sld:Name>
          <ogc:Filter>
            <ogc:Or>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>for_cde</ogc:PropertyName>
                <ogc:Literal>FOR020</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>for_cde</ogc:PropertyName>
                <ogc:Literal>FOR903</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:Or>
          </ogc:Filter>
          <sld:MaxScaleDenominator>500.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>BOX  L= <ogc:PropertyName>byc_len</ogc:PropertyName>  S= <ogc:PropertyName>pip_slp</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>17</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-17</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="allowOverlaps">true</sld:VendorOption>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
            <sld:VendorOption name="spaceAround">0</sld:VendorOption>
            <sld:VendorOption name="maxDisplacement">50</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_second</sld:Name>
          <sld:MaxScaleDenominator>500.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>( <ogc:PropertyName>sbk_hsl</ogc:PropertyName> ) ( <ogc:PropertyName>sbl_hsl</ogc:PropertyName> )</sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>17</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>10</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>00A396</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_first</sld:Name>
          <sld:MinScaleDenominator>500.0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>1000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>std_dip</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>14</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-30</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="allowOverlaps">true</sld:VendorOption>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
            <sld:VendorOption name="spaceAround">0</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_first</sld:Name>
          <sld:MinScaleDenominator>500.0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>1000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>L= <ogc:PropertyName>byc_len</ogc:PropertyName>  S= <ogc:PropertyName>pip_slp</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>14</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-10</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="allowOverlaps">true</sld:VendorOption>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
            <sld:VendorOption name="spaceAround">0</sld:VendorOption>
            <sld:VendorOption name="maxDisplacement">50</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_first</sld:Name>
          <ogc:Filter>
            <ogc:Or>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>for_cde</ogc:PropertyName>
                <ogc:Literal>FOR020</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>for_cde</ogc:PropertyName>
                <ogc:Literal>FOR903</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:Or>
          </ogc:Filter>
          <sld:MinScaleDenominator>500.0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>1000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>BOX  L= <ogc:PropertyName>byc_len</ogc:PropertyName>  S= <ogc:PropertyName>pip_slp</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-10</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
            <sld:VendorOption name="spaceAround">0</sld:VendorOption>
            <sld:VendorOption name="maxDisplacement">50</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_second</sld:Name>
          <sld:MinScaleDenominator>500.0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>1000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>( <ogc:PropertyName>sbk_hsl</ogc:PropertyName> ) ( <ogc:PropertyName>sbl_hsl</ogc:PropertyName> )</sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>10</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>00A396</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_first</sld:Name>
          <sld:MinScaleDenominator>1000.0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>2000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>L= <ogc:PropertyName>byc_len</ogc:PropertyName> , S= <ogc:PropertyName>pip_slp</ogc:PropertyName> , <ogc:PropertyName>std_dip</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>12</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-10</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>c047b7</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
            <sld:VendorOption name="spaceAround">0</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>road_text_second</sld:Name>
          <sld:MinScaleDenominator>1000.0</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>2000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>( <ogc:PropertyName>sbk_hsl</ogc:PropertyName> ) ( <ogc:PropertyName>sbl_hsl</ogc:PropertyName> )</sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>12</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
                  <ogc:Literal>normal</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>10</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>00A396</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">90</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
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
                    <ogc:Literal>swl_pipe_lm_bak_well_known_name</ogc:Literal>
                    <ogc:Literal>shape://oarrow</ogc:Literal>
                  </ogc:Function>
                </sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">
                    <ogc:Function name="strConcat">
                      <ogc:Literal>#</ogc:Literal>
                      <ogc:Function name="env">
                        <ogc:Literal>swl_pipe_lm_bak_fill</ogc:Literal>
                        <ogc:Literal>00A396</ogc:Literal>
                      </ogc:Function>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="fill-opacity">
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_fill_opacity</ogc:Literal>
                      <ogc:Literal>1</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                </sld:Fill>
                <sld:Stroke>
                  <sld:CssParameter name="stroke">
                    <ogc:Function name="strConcat">
                      <ogc:Literal>#</ogc:Literal>
                      <ogc:Function name="env">
                        <ogc:Literal>swl_pipe_lm_bak_stroke</ogc:Literal>
                        <ogc:Literal>00A396</ogc:Literal>
                      </ogc:Function>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="stroke-opacity">
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_stroke_opacity</ogc:Literal>
                      <ogc:Literal>1</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                  <sld:CssParameter name="stroke-width">
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_stroke_width</ogc:Literal>
                      <ogc:Literal>2</ogc:Literal>
                    </ogc:Function>
                  </sld:CssParameter>
                </sld:Stroke>
              </sld:Mark>
              <sld:Size>
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_size</ogc:Literal>
                  <ogc:Literal>20</ogc:Literal>
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
          <ogc:Filter>
            <ogc:PropertyIsGreaterThan>
              <ogc:Function name="strLength">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_property_name</ogc:Literal>
                  <ogc:Literal></ogc:Literal>
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
                  <ogc:Literal>swl_pipe_lm_bak_label_property_name</ogc:Literal>
                  <ogc:Literal></ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_pipe_lm_bak_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>swl_pipe_lm_bak_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_pipe_lm_bak_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_pipe_lm_bak_label_color</ogc:Literal>
                    <ogc:Literal>000000</ogc:Literal>
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