<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>tl_sprd_intrvl</sld:Title>
      <sld:Abstract>A layer style of tl_sprd_intrvl</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <sld:MaxScaleDenominator>10000.0</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>tl_sprd_intrvl_stroke</ogc:Literal>
                    <ogc:Literal>F1649D</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">
                <ogc:Function name="env">
                  <ogc:Literal>tl_sprd_intrvl_stroke_linecap</ogc:Literal>
                  <ogc:Literal>round</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>tl_sprd_intrvl_stroke_opacity</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="env">
                  <ogc:Literal>tl_sprd_intrvl_stroke_width</ogc:Literal>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>tl_sprd_intrvl_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Yu Gothic Medium</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>tl_sprd_intrvl_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">normal</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>5</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>3</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>tl_sprd_intrvl_label_color</ogc:Literal>
                    <ogc:Literal>000000</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:MaxScaleDenominator>2000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Geometry>
              <ogc:Function name="startPoint">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Geometry>
            <sld:Graphic>
              <sld:Mark>
                <sld:WellKnownName>shape://vertline</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#000000</sld:CssParameter>
                  <sld:CssParameter name="fill-opacity">0</sld:CssParameter>
                </sld:Fill>
                <sld:Stroke/>
              </sld:Mark>
              <sld:Size>15</sld:Size>
              <sld:Rotation>
                <ogc:Function name="startAngle">
                  <ogc:PropertyName>geom</ogc:PropertyName>
                </ogc:Function>
              </sld:Rotation>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:PointSymbolizer>
            <sld:Geometry>
              <ogc:Function name="endPoint">
                <ogc:PropertyName>geom</ogc:PropertyName>
              </ogc:Function>
            </sld:Geometry>
            <sld:Graphic>
              <sld:Mark>
                <sld:WellKnownName>shape://vertline</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#000000</sld:CssParameter>
                  <sld:CssParameter name="fill-opacity">0</sld:CssParameter>
                </sld:Fill>
                <sld:Stroke/>
              </sld:Mark>
              <sld:Size>15</sld:Size>
              <sld:Rotation>
                <ogc:Function name="endAngle">
                  <ogc:PropertyName>geom</ogc:PropertyName>
                </ogc:Function>
              </sld:Rotation>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="if_then_else">
                <ogc:Function name="equalTo">
                  <ogc:Function name="property">
                    <ogc:Literal>eve_bsi_sl</ogc:Literal>
                  </ogc:Function>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
                <ogc:Function name="numberFormat">
                  <ogc:Literal>0.00</ogc:Literal>
                  <ogc:Function name="property">
                    <ogc:Literal>eve_bsi_mn</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Function name="Concatenate">
                  <ogc:Function name="numberFormat">
                    <ogc:Literal>0.00</ogc:Literal>
                    <ogc:Function name="property">
                      <ogc:Literal>eve_bsi_mn</ogc:Literal>
                    </ogc:Function>
                  </ogc:Function>
                  <ogc:Literal>-</ogc:Literal>
                  <ogc:Function name="numberFormat">
                    <ogc:Literal>0.00</ogc:Literal>
                    <ogc:Function name="property">
                      <ogc:Literal>eve_bsi_sl</ogc:Literal>
                    </ogc:Function>
                  </ogc:Function>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Yu Gothic Medium</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="Categorize">
                  <ogc:Function name="env">
                    <ogc:Literal>wms_scale_denominator</ogc:Literal>
                  </ogc:Function>
                  <ogc:Literal>15</ogc:Literal>
                  <ogc:Literal>1500</ogc:Literal>
                  <ogc:Literal>10</ogc:Literal>
                  <ogc:Literal>3000</ogc:Literal>
                  <ogc:Literal>8</ogc:Literal>
                  <ogc:Literal>5000</ogc:Literal>
                  <ogc:Literal>8</ogc:Literal>
                  <ogc:Literal>10000</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                  <ogc:Literal>30000</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">normal</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>15</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>3</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#000000</sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">120</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="if_then_else">
                <ogc:Function name="equalTo">
                  <ogc:Function name="property">
                    <ogc:Literal>odd_bsi_sl</ogc:Literal>
                  </ogc:Function>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
                <ogc:Function name="numberFormat">
                  <ogc:Literal>0.00</ogc:Literal>
                  <ogc:Function name="property">
                    <ogc:Literal>odd_bsi_mn</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Function name="Concatenate">
                  <ogc:Function name="numberFormat">
                    <ogc:Literal>0.00</ogc:Literal>
                    <ogc:Function name="property">
                      <ogc:Literal>odd_bsi_mn</ogc:Literal>
                    </ogc:Function>
                  </ogc:Function>
                  <ogc:Literal>-</ogc:Literal>
                  <ogc:Function name="numberFormat">
                    <ogc:Literal>0.00</ogc:Literal>
                    <ogc:Function name="property">
                      <ogc:Literal>odd_bsi_sl</ogc:Literal>
                    </ogc:Function>
                  </ogc:Function>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Yu Gothic Medium</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="Categorize">
                  <ogc:Function name="env">
                    <ogc:Literal>wms_scale_denominator</ogc:Literal>
                  </ogc:Function>
                  <ogc:Literal>15</ogc:Literal>
                  <ogc:Literal>1500</ogc:Literal>
                  <ogc:Literal>12</ogc:Literal>
                  <ogc:Literal>3000</ogc:Literal>
                  <ogc:Literal>8</ogc:Literal>
                  <ogc:Literal>5000</ogc:Literal>
                  <ogc:Literal>8</ogc:Literal>
                  <ogc:Literal>10000</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                  <ogc:Literal>30000</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">normal</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:LinePlacement>
                <sld:PerpendicularOffset>-15</sld:PerpendicularOffset>
              </sld:LinePlacement>
            </sld:LabelPlacement>
            <sld:Halo>
              <sld:Radius>3</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#000000</sld:CssParameter>
            </sld:Fill>
            <sld:VendorOption name="followLine">true</sld:VendorOption>
            <sld:VendorOption name="maxAngleDelta">120</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

