<?xml version='1.0' encoding='UTF-8'?>
<sld:StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>wwtl_puri_as</sld:Title>
      <sld:Abstract>A layer style of wwtl_puri_as</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>wwtl_puri_as</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <sld:PolygonSymbolizer>
            <sld:Fill>
              <sld:CssParameter name="fill">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>wwtl_puri_as_fill</ogc:Literal>
                    <ogc:Literal>10ff54</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="fill-opacity">
                <ogc:Function name="env">
                  <ogc:Literal>wwtl_puri_as_fill_opacity</ogc:Literal>
                  <ogc:Literal>0.6</ogc:Literal> </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
            <sld:Stroke>
              <sld:CssParameter name="stroke">
                <ogc:Function name="strConcat">
                  <ogc:Literal>#</ogc:Literal>
                  <ogc:Function name="env">
                    <ogc:Literal>wwtl_puri_as_stroke</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="Categorize">
                  <ogc:Function name="env">
                    <ogc:Literal>wms_scale_denominator</ogc:Literal>
                  </ogc:Function>
                  <ogc:Literal>2.0</ogc:Literal> <ogc:Literal>1500</ogc:Literal>
                  <ogc:Literal>1.5</ogc:Literal> <ogc:Literal>3000</ogc:Literal>
                  <ogc:Literal>1.0</ogc:Literal> <ogc:Literal>5000</ogc:Literal>
                  <ogc:Literal>0.8</ogc:Literal> <ogc:Literal>10000</ogc:Literal>
                  <ogc:Literal>0.5</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:PolygonSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>Name</sld:Name>
          <sld:Title>wwtl_puri_as_label</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:PropertyIsGreaterThan>
              <ogc:Function name="strLength">
                <ogc:Function name="env">
                  <ogc:Literal>wwtl_puri_as_label_property_name</ogc:Literal>
                  <ogc:Literal></ogc:Literal>
                </ogc:Function>
              </ogc:Function>
              <ogc:Literal>0</ogc:Literal>
            </ogc:PropertyIsGreaterThan>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wwtl_puri_as_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wwtl_puri_as_label_size</ogc:Literal>
                  <ogc:Literal>15</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
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
              <sld:Radius>
                <ogc:Function name="env">
                  <ogc:Literal>wwtl_puri_as_label_halo_radius</ogc:Literal>
                  <ogc:Literal>1.5</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wwtl_puri_as_label_halo_color</ogc:Literal>
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
                    <ogc:Literal>wwtl_puri_as_label_color</ogc:Literal>
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