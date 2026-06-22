<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1501</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#f44336</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#f44336</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#f44336</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1502</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#e91e63</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#e91e63</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#e91e63</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1503</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#9c27b0</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#9c27b0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#9c27b0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1504</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#673ab7</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#673ab7</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#673ab7</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1506</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#3f51b5</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3f51b5</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3f51b5</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1508</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#2196f3</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#2196f3</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#2196f3</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1509</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#03a9f4</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#03a9f4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#03a9f4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1510</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#00BCD4</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#00BCD4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#00BCD4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1599</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#009688</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#009688</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#009688</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1501</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#f44336</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#f44336</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#f44336</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1502</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#e91e63</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#e91e63</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#e91e63</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1503</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#9c27b0</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#9c27b0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#9c27b0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1504</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#673ab7</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#673ab7</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#673ab7</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1506</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#3f51b5</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3f51b5</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3f51b5</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1508</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#2196f3</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#2196f3</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#2196f3</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1509</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#03a9f4</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#03a9f4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#03a9f4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1510</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#00BCD4</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#00BCD4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#00BCD4</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>road_rank</ogc:PropertyName>
              <ogc:Literal>1599</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#009688</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#009688</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#009688</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:MaxScaleDenominator>543262.4611597453</sld:MaxScaleDenominator>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#3d7fa0</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3d7fa0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3d7fa0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>road_name</ogc:PropertyName>
              <ogc:Function name="parseInt">
                <ogc:PropertyName>road_no</ogc:PropertyName>
              </ogc:Function>
              -
              <ogc:Function name="parseInt">
                <ogc:PropertyName>sect</ogc:PropertyName>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">16</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:Halo>
              <sld:Radius>1</sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">#114E7E</sld:CssParameter>
              </sld:Fill>
            </sld:Halo>
            <sld:Fill>
              <sld:CssParameter name="fill">#ffffff</sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#ffffff</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-opacity">0</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Geometry>
              <ogc:PropertyName>geom</ogc:PropertyName>
            </sld:Geometry>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#3d7fa0</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
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
              <sld:Mark>
                <sld:WellKnownName>triangle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3d7fa0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>14</sld:Size>
              <sld:Rotation>
                <ogc:Sub>
                  <ogc:Function name="startAngle">
                    <ogc:PropertyName>geom</ogc:PropertyName>
                  </ogc:Function>
                  <ogc:Literal>90</ogc:Literal>
                </ogc:Sub>
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
                <sld:WellKnownName>circle</sld:WellKnownName>
                <sld:Fill>
                  <sld:CssParameter name="fill">#3d7fa0</sld:CssParameter>
                </sld:Fill>
              </sld:Mark>
              <sld:Size>9</sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

