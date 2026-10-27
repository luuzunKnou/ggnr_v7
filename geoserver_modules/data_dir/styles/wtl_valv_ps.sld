<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:sld="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default Styler</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:Title>wtl_valv_ps</sld:Title>
      <sld:Abstract>A layer style of wtl_valv_ps scaled to match fire_ps</sld:Abstract>
      <sld:FeatureTypeStyle>
        <sld:Name>name</sld:Name>
        <sld:Rule>
          <sld:Name>SA200</sld:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA200</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps_sa200.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA200</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA200</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA201</sld:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA201</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps_sa201.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA201</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA201</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA202</sld:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA202</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps_sa202.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA202</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA202</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA203</sld:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA203</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps_sa203.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA203</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA203</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA204</sld:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA204</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps_sa204.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA204</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA204</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA205</sld:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA205</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps_sa205.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA205</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA205</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA209</sld:Name>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA209</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps_sa209.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>SA209</sld:Name>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA209</ogc:Literal>
              </ogc:PropertyIsEqualTo>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
              </sld:CssParameter>
            </sld:Fill>
          </sld:TextSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>name</sld:Name>
          <sld:Title>Title</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <sld:ElseFilter/>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="/www/symbol/water/wtl_valv_ps.svg"/>
                <sld:Format>image/svg+xml</sld:Format>
              </sld:ExternalGraphic>
              <sld:Size>
                <ogc:Function name="if_then_else">
                  <ogc:Function name="greaterThan">
                    <ogc:Add>
                      <ogc:Function name="Categorize">
                        <ogc:Function name="env">
                          <ogc:Literal>wms_scale_denominator</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>30</ogc:Literal>
                        <ogc:Literal>500</ogc:Literal>
                        <ogc:Literal>27</ogc:Literal>
                        <ogc:Literal>800</ogc:Literal>
                        <ogc:Literal>25</ogc:Literal>
                        <ogc:Literal>1500</ogc:Literal>
                        <ogc:Literal>22</ogc:Literal>
                      </ogc:Function>
                      <ogc:Sub>
                        <ogc:Function name="env">
                          <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                          <ogc:Literal>18</ogc:Literal>
                        </ogc:Function>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Sub>
                    </ogc:Add>
                    <ogc:Literal>1</ogc:Literal>
                  </ogc:Function>
                  <ogc:Add>
                    <ogc:Function name="Categorize">
                      <ogc:Function name="env">
                        <ogc:Literal>wms_scale_denominator</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>30</ogc:Literal>
                      <ogc:Literal>500</ogc:Literal>
                      <ogc:Literal>27</ogc:Literal>
                      <ogc:Literal>800</ogc:Literal>
                      <ogc:Literal>25</ogc:Literal>
                      <ogc:Literal>1500</ogc:Literal>
                      <ogc:Literal>22</ogc:Literal>
                    </ogc:Function>
                    <ogc:Sub>
                      <ogc:Function name="env">
                        <ogc:Literal>wtl_valv_ps_size</ogc:Literal>
                        <ogc:Literal>18</ogc:Literal>
                      </ogc:Function>
                      <ogc:Literal>18</ogc:Literal>
                    </ogc:Sub>
                  </ogc:Add>
                  <ogc:Literal>1</ogc:Literal>
                </ogc:Function>
              </sld:Size>
            </sld:Graphic>
          </sld:PointSymbolizer>
        </sld:Rule>
        <sld:Rule>
          <sld:Name>name</sld:Name>
          <sld:Title>label</sld:Title>
          <sld:Abstract>Abstract</sld:Abstract>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsGreaterThan>
                <ogc:Function name="strLength">
                  <ogc:Function name="env">
                    <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                    <ogc:Literal></ogc:Literal>
                  </ogc:Function>
                </ogc:Function>
                <ogc:Literal>0</ogc:Literal>
              </ogc:PropertyIsGreaterThan>
              <ogc:Not>
                <ogc:Or>
                  <ogc:PropertyIsEqualTo>
                    <ogc:Function name="strToUpperCase">
                      <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>SA200</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:Function name="strToUpperCase">
                      <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>SA201</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:Function name="strToUpperCase">
                      <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>SA202</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:Function name="strToUpperCase">
                      <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>SA203</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:Function name="strToUpperCase">
                      <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>SA204</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:Function name="strToUpperCase">
                      <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>SA205</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                  <ogc:PropertyIsEqualTo>
                    <ogc:Function name="strToUpperCase">
                      <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                    </ogc:Function>
                    <ogc:Literal>SA209</ogc:Literal>
                  </ogc:PropertyIsEqualTo>
                </ogc:Or>
              </ogc:Not>
            </ogc:And>
          </ogc:Filter>
          <sld:MaxScaleDenominator>3000.0</sld:MaxScaleDenominator>
          <sld:TextSymbolizer>
            <sld:Label>
              <ogc:Function name="property">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_property_name</ogc:Literal>
                  <ogc:Literal/>
                </ogc:Function>
              </ogc:Function>
            </sld:Label>
            <sld:Font>
              <sld:CssParameter name="font-family">Gulim</sld:CssParameter>
              <sld:CssParameter name="font-size">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_size</ogc:Literal>
                  <ogc:Literal>0</ogc:Literal>
                </ogc:Function>
              </sld:CssParameter>
              <sld:CssParameter name="font-style">normal</sld:CssParameter>
              <sld:CssParameter name="font-weight">
                <ogc:Function name="env">
                  <ogc:Literal>wtl_valv_ps_label_font_weight</ogc:Literal>
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
                  <ogc:Literal>wtl_valv_ps_label_halo_radius</ogc:Literal>
                  <ogc:Literal>2</ogc:Literal>
                </ogc:Function>
              </sld:Radius>
              <sld:Fill>
                <sld:CssParameter name="fill">
                  <ogc:Function name="strConcat">
                    <ogc:Literal>#</ogc:Literal>
                    <ogc:Function name="env">
                      <ogc:Literal>wtl_valv_ps_label_halo_color</ogc:Literal>
                      <ogc:Literal>000000</ogc:Literal>
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
                    <ogc:Literal>wtl_valv_ps_label_color</ogc:Literal>
                    <ogc:Literal>FFFFFF</ogc:Literal>
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
