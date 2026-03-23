locals {
  api_gw_id = data.terraform_remote_state.bic_infra.outputs.api_gw_id
}


resource "aws_apigatewayv2_integration" "lambda_handler" {
  api_id = local.api_gw_id

  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.search_function.invoke_arn
  payload_format_version = "2.0"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_route" "search_get" {
  api_id = local.api_gw_id

  route_key          = "GET /search"
  target             = "integrations/${aws_apigatewayv2_integration.lambda_handler.id}"
  authorization_type = "AWS_IAM"
}

resource "aws_apigatewayv2_route" "default_get" {
  api_id = local.api_gw_id

  route_key          = "GET /"
  target             = "integrations/${aws_apigatewayv2_integration.lambda_handler.id}"
  authorization_type = "AWS_IAM"
}

resource "aws_apigatewayv2_stage" "embed_stage" {
  api_id = local.api_gw_id

  name        = var.environment
  auto_deploy = true
}
