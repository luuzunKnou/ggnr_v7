<?xml version="1.0" encoding="UTF-8"?>
<sld:StyledLayerDescriptor
    xmlns="http://www.opengis.net/sld"
    xmlns:sld="http://www.opengis.net/sld"
    xmlns:gml="http://www.opengis.net/gml"
    xmlns:ogc="http://www.opengis.net/ogc"
    version="1.0.0">

  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>

    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>swl_cons_as</sld:Title>
      <sld:Abstract>A layer style of swl_cons_as</sld:Abstract>

      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>

        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>

          <sld:PolygonSymbolizer>
            <sld:Fill>
              <sld:CssParameter name="fill">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>swl_cons_as_fill</ogc:Literal>
                    <ogc:Literal>FFFF00</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>

              <sld:CssParameter name="fill-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_fill_opacity</ogc:Literal>
                  <ogc:Literal>0.07</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>

            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>swl_cons_as_stroke</ogc:Literal>
                    <ogc:Literal>FFD700</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>

              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_stroke_width</ogc:Literal>
                  <ogc:Literal>0.3</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:PolygonSymbolizer>
        </sld:Rule>

        <sld:Rule>
          <sld:Name>Label_120_480</sld:Name>


          <ogc:Filter>
            <ogc:PropertyIsGreaterThan>
              <ogc:Function name="strLength">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_property_name</ogc:Literal>
                  <ogc:Literal>cons_name</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
              <ogc:Literal>0</ogc:Literal>
            </ogc:PropertyIsGreaterThan>
          </ogc:Filter>
          <sld:MinScaleDenominator>4261</sld:MinScaleDenominator>
          <sld:MaxScaleDenominator>17044</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_property_name</ogc:Literal>
                  <ogc:Literal>cons_name</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>

            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>

              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_size</ogc:Literal>
                  <ogc:Literal>13</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>

              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_font_weight</ogc:Literal>
                  <ogc:Literal>bold</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>

            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>1</sld:AnchorPointY>
                </sld:AnchorPoint>

                <sld:Displacement>
                  <sld:DisplacementX>0</sld:DisplacementX>
                  <sld:DisplacementY>0</sld:DisplacementY>
                </sld:Displacement>
              </sld:PointPlacement>
            </sld:LabelPlacement>

            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_cons_as_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_cons_as_label_color</ogc:Literal>
                    <ogc:Literal>333333</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>

            <sld:VendorOption name="allowOverlaps">true</sld:VendorOption>
            <sld:VendorOption name="goodnessOfFit">0.1</sld:VendorOption>
            <sld:VendorOption name="priority">100</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>

        <sld:Rule>
          <sld:Name>Label_Under_120</sld:Name>


          <ogc:Filter>
            <ogc:PropertyIsGreaterThan>
              <ogc:Function name="strLength">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_property_name</ogc:Literal>
                  <ogc:Literal>cons_name</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
              <ogc:Literal>0</ogc:Literal>
            </ogc:PropertyIsGreaterThan>
          </ogc:Filter>
          <sld:MaxScaleDenominator>4261</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_property_name</ogc:Literal>
                  <ogc:Literal>cons_name</ogc:Literal>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>

            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>

              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_size</ogc:Literal>
                  <ogc:Literal>14</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>

              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_font_weight</ogc:Literal>
                  <ogc:Literal>bold</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Font>

            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>1</sld:AnchorPointY>
                </sld:AnchorPoint>

                <sld:Displacement>
                  <sld:DisplacementX>0</sld:DisplacementX>
                  <sld:DisplacementY>0</sld:DisplacementY>
                </sld:Displacement>
              </sld:PointPlacement>
            </sld:LabelPlacement>

            <sld:Halo>
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>swl_cons_as_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>swl_cons_as_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>swl_cons_as_label_color</ogc:Literal>
                    <ogc:Literal>333333</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>

            <sld:VendorOption name="allowOverlaps">true</sld:VendorOption>
            <sld:VendorOption name="goodnessOfFit">0.1</sld:VendorOption>
            <sld:VendorOption name="priority">100</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>

      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>