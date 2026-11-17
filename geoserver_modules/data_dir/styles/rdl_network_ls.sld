<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Title>국도</sld:Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>점선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>파선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>고속도로</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>국도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#1E4FA8</sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">
                <ogc:Function name="if_then_else">
                  <ogc:Function name="equalTo">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>고속도로</ogc:Literal>
                  </ogc:Function>
                  <ogc:Literal>4</ogc:Literal>
                  <ogc:Literal>3.5</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>국도 (미개설)</sld:Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>linetype</ogc:PropertyName>
                  <ogc:Literal>점선</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>linetype</ogc:PropertyName>
                  <ogc:Literal>파선</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>고속도로</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>국도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#1E4FA8</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">3.5</sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">10.0 6.0</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>지방도</sld:Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>점선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>파선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>국가지원지방도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>지방도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#F5C400</sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">3</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>지방도 (미개설)</sld:Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>linetype</ogc:PropertyName>
                  <ogc:Literal>점선</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>linetype</ogc:PropertyName>
                  <ogc:Literal>파선</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>국가지원지방도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>지방도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#F5C400</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">3</sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">10.0 6.0</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>군도</sld:Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>점선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>파선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>시군도</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#1F76AC</sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2.5</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>군도 (미개설)</sld:Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>linetype</ogc:PropertyName>
                  <ogc:Literal>점선</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>linetype</ogc:PropertyName>
                  <ogc:Literal>파선</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>시군도</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#1F76AC</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2.5</sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">2.0 4.0</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>농도</sld:Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>점선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>linetype</ogc:PropertyName>
                <ogc:Literal>파선</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>농도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>리도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>면도</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
            </ogc:And>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#883700</sld:CssParameter>
              <sld:CssParameter name="stroke-linecap">round</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>농도 (미개설)</sld:Title>
          <ogc:Filter>
            <ogc:Or>
              <ogc:And>
                <ogc:Or>
                  <ogc:PropertyIsEqualTo>
                    <ogc:PropertyName>linetype</ogc:PropertyName>
                    <ogc:Literal>점선</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:PropertyName>linetype</ogc:PropertyName>
                    <ogc:Literal>파선</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                </ogc:Or>
                <ogc:Or>
                  <ogc:PropertyIsEqualTo>
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>농도</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>리도</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>면도</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                </ogc:Or>
              </ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>농도(파선)</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>리도(파선)</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>면도(파선)</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:Or>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#883700</sld:CssParameter>
              <sld:CssParameter name="stroke-linejoin">round</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">10.0 6.0</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Title>철도</sld:Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>layer</ogc:PropertyName>
              <ogc:Literal>철도</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#212121</sld:CssParameter>
              <sld:CssParameter name="stroke-width">4</sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">1.0 0.0</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
          <sld:LineSymbolizer>
            <sld:Stroke>
              <sld:CssParameter name="stroke">#FFFFFF</sld:CssParameter>
              <sld:CssParameter name="stroke-width">2</sld:CssParameter>
              <sld:CssParameter name="stroke-dasharray">8.0 8.0</sld:CssParameter>
            </sld:Stroke>
          </sld:LineSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

