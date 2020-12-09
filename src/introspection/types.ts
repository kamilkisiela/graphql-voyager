import { GraphQLArgument, GraphQLField, GraphQLNamedType, IntrospectionEnumValue, TypeKind } from 'graphql';

export type SimplifiedArg = {
  name: string;
  description: string;
  defaultValue: any;
  typeWrappers: (typeof TypeKind.LIST | typeof TypeKind.NON_NULL)[];
  id?: string;
  astNode?: GraphQLArgument['astNode']
};

export type SimplifiedField<T> = {
  name: string;
  type: T;
  id?: string;
  relayType: T;
  description: string;
  typeWrappers: (typeof TypeKind.LIST | typeof TypeKind.NON_NULL)[];
  isDeprecated: boolean;
  deprecationReason?: string;
  args: {
    [name: string]: SimplifiedArg;
  };
  relayArgs: {
    [name: string]: SimplifiedArg;
  };
  astNode?: GraphQLField<any, any>['astNode']
};

export type SimplifiedInputField = SimplifiedArg;

export type SimplifiedTypeBase = {
  kind: 'OBJECT' | 'INTERFACE' | 'UNION' | 'ENUM' | 'INPUT_OBJECT' | 'SCALAR';
  name: string;
  description: string;
  enumValues?: IntrospectionEnumValue[];
  inputFields?: {
    [name: string]: SimplifiedInputField;
  };
  isRelayType?: boolean;
  astNode?: GraphQLNamedType['astNode']
};

export type SimplifiedType = SimplifiedTypeBase & {
  fields?: {
    [name: string]: SimplifiedField<string>;
  };
  interfaces?: string[];
  derivedTypes?: string[];
  possibleTypes?: string[];
};

export type SimplifiedTypeWithIDs = SimplifiedTypeBase & {
  id: string;
  fields?: {
    [name: string]: SimplifiedField<SimplifiedTypeWithIDs>;
  };
  interfaces?: {
    id: string;
    type: SimplifiedTypeWithIDs;
  }[];
  derivedTypes?: {
    id: string;
    type: SimplifiedTypeWithIDs;
  }[];
  possibleTypes?: {
    id: string;
    type: SimplifiedTypeWithIDs;
  }[];
};

export type SimplifiedIntrospection = {
  types: {
    [typeName: string]: SimplifiedType;
  };
  queryType: string;
  mutationType: string | null;
  subscriptionType: string | null;
};

export type SimplifiedIntrospectionWithIds = {
  types: {
    [typeName: string]: SimplifiedTypeWithIDs;
  };
  queryType: SimplifiedTypeWithIDs;
  mutationType: SimplifiedTypeWithIDs | null;
  subscriptionType: SimplifiedTypeWithIDs | null;
};
