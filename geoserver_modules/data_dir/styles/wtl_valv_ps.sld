<?xml version="1.0" encoding="UTF-8"?><sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" xmlns="http://www.opengis.net/sld" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" version="1.0.0">
  <sld:NamedLayer>
    <sld:Name>Default layer</sld:Name>
    <sld:UserStyle>
      <sld:Name>Default Styler</sld:Name>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA200</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps_sa200.svg"/>
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
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA201</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps_sa201.svg"/>
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
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA202</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps_sa202.svg"/>
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
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA203</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps_sa203.svg"/>
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
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA204</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps_sa204.svg"/>
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
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA205</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps_sa205.svg"/>
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
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:Function name="strToUpperCase">
                <ogc:PropertyName>ftr_cde</ogc:PropertyName>
              </ogc:Function>
              <ogc:Literal>SA209</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps_sa209.svg"/>
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
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsNotEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA200</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA201</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA202</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA203</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA204</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA205</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
              <ogc:PropertyIsNotEqualTo>
                <ogc:Function name="strToUpperCase">
                  <ogc:PropertyName>ftr_cde</ogc:PropertyName>
                </ogc:Function>
                <ogc:Literal>SA209</ogc:Literal>
              </ogc:PropertyIsNotEqualTo>
            </ogc:And>
          </ogc:Filter>
          <sld:PointSymbolizer>
            <sld:Graphic>
              <sld:ExternalGraphic>
                <sld:OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="http://127.0.0.1:8090/geoserver/www/symbol/water/wtl_valv_ps.svg"/>
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
        <sld:VendorOption name="ruleEvaluation">first</sld:VendorOption>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>

