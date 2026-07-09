locals {
  api_gw_id = data.terraform_remote_state.bic_infra.outputs.api_gw_id
}


resource "aws_apigatewayv2_integration" "lambda_handler" {
  api_id = local.api_gw_id

  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.search_function.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = var.api_gateway_timeout

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_route" "search_default_post" {
  api_id = local.api_gw_id

  route_key          = "POST /search"
  target             = "integrations/${aws_apigatewayv2_integration.lambda_handler.id}"
  authorization_type = "NONE"
}

resource "aws_apigatewayv2_route" "search_healthcheck_get" {
  api_id = local.api_gw_id

  route_key          = "GET /search/healthcheck"
  target             = "integrations/${aws_apigatewayv2_integration.lambda_handler.id}"
  authorization_type = "NONE"
}
