<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
              </ogc:PropertyIsLike>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�⑥쥙�꺗占쎈즲嚥∽옙</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>24</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>24</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>24</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Not>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
              </ogc:Not>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�⑥쥙�꺗占쎈즲嚥∽옙</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_highway.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>24</sld:Size>
            </sld:Graphic>
            <sld:Priority>1000</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_highway.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>24</sld:Size>
            </sld:Graphic>
            <sld:Priority>1000</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_highway.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>24</sld:Size>
            </sld:Graphic>
            <sld:Priority>1000</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
              </ogc:PropertyIsLike>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占쏙옙猷�</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Not>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
              </ogc:Not>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占쏙옙猷�</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_national.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>900</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_national.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>900</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#FFFFFF</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_national.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>900</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
              </ogc:PropertyIsLike>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占썲첎占쏙쭪占쏙옙�뜚筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Not>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
              </ogc:Not>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占썲첎占쏙쭪占쏙옙�뜚筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_provincial.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>800</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_provincial.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>800</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_provincial.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>800</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
              </ogc:PropertyIsLike>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Not>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
              </ogc:Not>
              <ogc:PropertyIsEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_provincial.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>700</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_provincial.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>700</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_provincial.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>700</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:And>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                  <ogc:PropertyIsEqualTo>
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>占쎈뻻�뤃怨뚮럡</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                </ogc:And>
                <ogc:And>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                  <ogc:PropertyIsEqualTo>
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>占쎈뻻�뤃怨뺣즲</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                </ogc:And>
              </ogc:Or>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�⑥쥙�꺗占쎈즲嚥∽옙</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占썲첎占쏙쭪占쏙옙�뜚筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占쏙옙猷�</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#1E4FA8</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#1E4FA8</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#1E4FA8</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌욑옙獄쎻뫖猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�뤃占썲첎占쏙쭪占쏙옙�뜚筌욑옙獄쎻뫖猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�뤃占쏙옙猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�⑥쥙�꺗占쎈즲嚥∽옙</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>占쎈뻻�뤃怨뚮럡</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>占쎈뻻�뤃怨뺣즲</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>占쎈뻻�뤃怨뚮럡</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>占쎈뻻�뤃怨뺣즲</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#1E4FA8</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_county.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>600</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#1E4FA8</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_county.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>600</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#1E4FA8</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_county.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>600</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Or>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>占쎈꺗占쎈즲</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫�猷�</ogc:Literal>
                </ogc:PropertyIsEqualTo>
                <ogc:PropertyIsEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�뵳�됰즲</ogc:Literal>
                </ogc:PropertyIsEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌욑옙獄쎻뫖猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌욑옙獄쎻뫖猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�뤃占썲첎占쏙쭪占쏙옙�뜚筌욑옙獄쎻뫖猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�뤃占썲첎占쏙쭪占쏙옙�뜚筌욑옙獄쎻뫖猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�뤃占쏙옙猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�뤃占쏙옙猷�</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�⑥쥙�꺗占쎈즲嚥∽옙</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:Or>
                <ogc:Not>
                  <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                    <ogc:PropertyName>layer</ogc:PropertyName>
                    <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                  </ogc:PropertyIsLike>
                </ogc:Not>
                <ogc:PropertyIsNotEqualTo>
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>�⑥쥙�꺗占쎈즲嚥∽옙</ogc:Literal>
                </ogc:PropertyIsNotEqualTo>
              </ogc:Or>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>占쎈뻻�뤃怨뚮럡</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>占쎈뻻�뤃怨뺣즲</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <ogc:Filter>
            <ogc:And>
              <ogc:Not>
                <ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\">
                  <ogc:PropertyName>layer</ogc:PropertyName>
                  <ogc:Literal>筌롫��봺占쎈꺗占쎈즲%</ogc:Literal>
                </ogc:PropertyIsLike>
              </ogc:Not>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>占쎈꺗占쎈즲</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>占쎈뻻�뤃怨뚮럡</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>占쎈뻻�뤃怨뺣즲</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌롫�猷�</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�⑥쥙�꺗占쎈즲嚥∽옙</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占썲첎占쏙쭪占쏙옙�뜚筌욑옙獄쎻뫖猷�</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뤃占쏙옙猷�</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:PropertyName>layer</ogc:PropertyName>
                <ogc:Literal>�뵳�됰즲</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Nanum Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Malgun Gothic</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:PropertyName>num</ogc:PropertyName>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">SansSerif</sld:CssParameter>
              <sld:CssParameter name="font-size">12</sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">bold</sld:CssParameter>
            </sld:Font>
            <sld:LabelPlacement>
              <sld:PointPlacement>
                <sld:AnchorPoint>
                  <sld:AnchorPointX>0.5</sld:AnchorPointX>
                  <sld:AnchorPointY>0.5</sld:AnchorPointY>
                </sld:AnchorPoint>
              </sld:PointPlacement>
            </sld:LabelPlacement>
            <sld:Fill>
              <sld:CssParameter name="fill">#212121</sld:CssParameter>
            </sld:Fill>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="road_shield_local.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>20</sld:Size>
            </sld:Graphic>
            <sld:Priority>100</sld:Priority>
            <sld:VendorOption name="conflictResolution">false</sld:VendorOption>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

