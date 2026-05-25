export interface ProfileMeta {
  file: string;
  description: string;
  character_name: string;
  avatar: string;
  avatar_abs_path: string | null;
}

export interface ProfileConfig {
  profile: {
    description: string;
  };
  character?: {
    live2d_model_name?: string;
    character_name?: string;
    avatar?: string;
    human_name?: string;
    default_expression_emotion?: string;
    tts_preprocessor?: {
      remove_special_char?: boolean;
      ignore_brackets?: boolean;
      ignore_parentheses?: boolean;
      ignore_asterisks?: boolean;
      ignore_angle_brackets?: boolean;
    };
    tts?: {
      character_name?: string;
      voice?: string;
    };
  };
  prompt?: {
    persona?: string;
    format?: string;
    show_control_tags?: boolean;
  };
  plugins?: {
    enabled?: string[];
    [key: string]: unknown;
  };
}
