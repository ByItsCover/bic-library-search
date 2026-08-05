import os
import sys

from typing import Optional

from huggingface_hub import hf_hub_download
from transformers import CLIPTokenizer

import torch
import open_clip
from gliner import GLiNER

import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxruntime.quantization.shape_inference import quant_pre_process


def hf_download(destination: str, repo_id: str, filenames: list[str]):

    os.makedirs(destination, exist_ok=True)

    for name in filenames:

        hf_hub_download(
            repo_id=repo_id,
            filename=name,
            local_dir=destination
        )

    print(f"Model {repo_id} downloaded to {destination}/")

def quantized_download(
        clip_destination: str,
        gliner_destination: str,
        clean_cache: bool = True
    ):

    clip_filename = "open_clip_model.safetensors"
    gliner_filename = "pytorch_model.bin"

    clip_script_state = {
        "model_name": "ViT-B-32",
        "pretrained_name": os.path.join(
            clip_destination,
            clip_filename
        ),
        "onnx_model_path": os.path.join(
            clip_destination,
            "clip_text.onnx"
        ),
        "onnx_model_shapes_path": os.path.join(
            clip_destination,
            "clip_shapes.onnx"
        ),
        "quant_pre_model_path": os.path.join(
            clip_destination,
            "clip_pre_quantized.onnx"
        ),
        "quant_model_path": os.path.join(
            clip_destination,
            "clip_quantized.onnx"
        ),
        "preprocess_path": os.path.join(
            clip_destination,
            "preprocess.onnx"
        ),
        "device": "cpu"
    }

    gliner_script_state = {
        "pretrained_name": os.path.join(
            gliner_destination,
            gliner_filename
        ),
        "onnx_model_name": "gliner.onnx",
        "onnx_model_path": os.path.join(
            gliner_destination,
            "gliner.onnx"
        ),
        "onnx_model_shapes_path": os.path.join(
            gliner_destination,
            "gliner_shapes.onnx"
        ),
        "quant_pre_model_path": os.path.join(
            gliner_destination,
            "gliner_pre_quantized.onnx"
        ),
        "quant_model_name": "gliner_quantized.onnx",
        "quant_model_path": os.path.join(
            gliner_destination,
            "gliner_quantized.onnx"
        ),
        "preprocess_path": os.path.join(
            gliner_destination,
            "preprocess.onnx"
        ),
        "device": "cpu"
    }

    os.makedirs(clip_destination, exist_ok=True)
    os.makedirs(gliner_destination, exist_ok=True)


    print("Loading Clip...")

    class CLIPText(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.transformer = model.transformer
            self.positional_embedding = model.positional_embedding
            self.ln_final = model.ln_final
            self.text_projection = model.text_projection
            self.token_embedding = model.token_embedding
            self.text_pool_type = model.text_pool_type
            self.text_eos_id = model.text_eos_id
            self.register_buffer('attn_mask', model.attn_mask, persistent=False)

        def forward(self, text):
            cast_dtype = self.transformer.get_cast_dtype()

            x = self.token_embedding(text)  # [batch_size, n_ctx, d_model]

            x = x + self.positional_embedding.to(cast_dtype)
            x = self.transformer(x, attn_mask=self.attn_mask)
            x = self.ln_final(x)  # [batch_size, n_ctx, transformer.width]
            x = self.text_global_pool(x, text, self.text_pool_type, eos_token_id=getattr(self, "text_eos_id", None))
            if self.text_projection is not None:
                if isinstance(self.text_projection, torch.nn.Linear):
                    x = self.text_projection(x)
                else:
                    x = x @ self.text_projection

            return x

        def text_global_pool(
                self,
                x: torch.Tensor,
                text: Optional[torch.Tensor] = None,
                pool_type: str = 'argmax',
                eos_token_id: Optional[int] = None,
        ) -> torch.Tensor:
            if pool_type == 'first':
                pooled = x[:, 0]
            elif pool_type == 'last':
                pooled = x[:, -1]
            elif pool_type == 'argmax':
                # take features from the eot embedding (eot_token is the highest number in each sequence)
                assert text is not None
                pooled = x[torch.arange(x.shape[0], device=x.device), text.argmax(dim=-1)]
            elif pool_type == 'eos':
                # take features from tokenizer specific eos
                assert text is not None
                assert eos_token_id is not None
                idx = (text == eos_token_id).int().argmax(dim=-1)
                pooled = x[torch.arange(x.shape[0], device=x.device), idx]
            else:
                pooled = x

            return pooled

    class UniEncoderSpanWrapper(torch.nn.Module):
        def __init__(self, core):
            super().__init__()
            self.core = core

        def forward(
            self,
            input_ids,
            attention_mask,
            words_mask,
            text_lengths,
            span_idx,
            span_mask,
        ):
            out = self.core(
                input_ids=input_ids,
                attention_mask=attention_mask,
                words_mask=words_mask,
                text_lengths=text_lengths,
                span_idx=span_idx,
                span_mask=span_mask,
            )
            return out.logits if hasattr(out, "logits") else out[0]

    clip_model, _, _ = open_clip.create_model_and_transforms(
        clip_script_state["model_name"],
        pretrained=clip_script_state["pretrained_name"],
        device=clip_script_state["device"]
    )
    tokenizer: CLIPTokenizer = CLIPTokenizer.from_pretrained(clip_destination)
    clip_text = CLIPText(clip_model)
    clip_text.eval()

    print(clip_text)

    gliner_model = GLiNER.from_pretrained(gliner_destination, load_tokenizer=True)

    gliner_model.config.to_json_file(os.path.join(gliner_destination, "gliner_config.json"))
    gliner_model.data_processor.transformer_tokenizer.save_pretrained(gliner_destination)

    gliner_wrapper = UniEncoderSpanWrapper(gliner_model.model.eval())
    gliner_wrapper.eval()

    print(gliner_wrapper)


    print("Exporting model to onnx format...")

    #input_tensor = torch.ones((2, 3, 224, 224), dtype=torch.float32)
    tokens = tokenizer(["some dummy", "text", "and something"], return_tensors='pt', padding="max_length")
    print("Tokens:")
    print(tokens)
    #input_tensor = torch.tensor(tokens.get("input_ids"))
    input_tensor = tokens.get("input_ids")

    torch.onnx.export(clip_text,
                  (input_tensor,),
                  clip_script_state["onnx_model_path"],
                  input_names = ['text'],
                  output_names = ['embeddings'],
                  dynamic_shapes=({0: torch.export.Dim.DYNAMIC},),
                  external_data=False
                  )


    text = "ONNX is an open-source format designed to enable the interoperability of AI models across various frameworks and tools."
    labels = ['format', 'model', 'tool', 'cat']
    inputs = gliner_model._build_dummy_batch(labels, text)
    spec = gliner_model._get_onnx_input_spec()
    all_inputs = (inputs['input_ids'], inputs['attention_mask'],
                    inputs['words_mask'], inputs['text_lengths'],
                    inputs['span_idx'], inputs['span_mask'])

    torch.onnx.export(gliner_wrapper,
                    all_inputs,
                    gliner_script_state["onnx_model_path"],
                    input_names = spec['input_names'],
                    output_names = spec['output_names'],
                    dynamic_axes= spec['dynamic_axes'],
                    dynamo=False,
                    external_data=False
                    )

    if clean_cache:
        print("Cleaning up...")
        os.remove(clip_script_state["pretrained_name"])
        os.remove(gliner_script_state["pretrained_name"])

    if os.path.isfile(clip_script_state["onnx_model_path"] + '.data'):
        os.remove(clip_script_state["onnx_model_path"] + '.data')

    if os.path.isfile(gliner_script_state["onnx_model_path"] + '.data'):
        os.remove(gliner_script_state["onnx_model_path"] + '.data')


    #print(f"Model {clip_script_state["pretrained_name"]} quantized to {clip_destination}/")
    print(f"Model {clip_script_state["pretrained_name"]} onnx exported to {clip_destination}/")
    #print(f"Model {gliner_script_state["pretrained_name"]} quantized to {gliner_destination}/")
    print(f"Model {gliner_script_state["pretrained_name"]} onnx exported to {gliner_destination}/")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise ValueError("Destination path is missing")

    clip_destination = os.path.join(sys.argv[1], "clip_model")
    gliner_destination = os.path.join(sys.argv[1], "gliner_model")
    hf_download(
        clip_destination,
        "laion/CLIP-ViT-B-32-laion2B-s34B-b79K",
        ["open_clip_model.safetensors", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]
    )
    hf_download(
        gliner_destination,
        "urchade/gliner_base",
        ["pytorch_model.bin", "gliner_config.json"]
    )
    quantized_download(clip_destination, gliner_destination)
