export interface ProfileMeta {
  file: string;
  name: string;
  description: string;
  agent_name: string;
  character_name: string;
  avatar: string;
}

export interface ProfileConfig {
  profile: {
    name: string;
    description: string;
    agent_name: string;
  };
  character?: {
    conf_name?: string;
    conf_uid?: string;
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
