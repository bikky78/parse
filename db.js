// db.js
const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize("prod2_hcm", "postgres", "1L7DSUhUF5Irg0GwC29)BYZvj~!a", {
  host: "stagehcm.cluster-ctq0cwagah71.ap-south-1.rds.amazonaws.com",
  dialect: "postgres",
  logging: false,
});

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: DataTypes.STRING,
    email: DataTypes.STRING,
    mobile_number: DataTypes.STRING,
    is_active: DataTypes.BOOLEAN,
    is_first_time_login:DataTypes.BOOLEAN,
    is_external: DataTypes.BOOLEAN,
    corporation_id: DataTypes.NUMBER,
    designation: DataTypes.STRING,
    role_id: {
      type: DataTypes.ARRAY(DataTypes.INTEGER),
      allowNull: false,
    },
  },
  {
    schema: "user_management",
    tableName: "user",
    timestamps: true,
  }
);

const Employee = sequelize.define(
  "Employee",
  {
    employee_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    first_name: DataTypes.STRING,
    employee_code: DataTypes.STRING,
    personal_email: DataTypes.STRING,
    work_email: DataTypes.STRING,
    candidate_id: DataTypes.INTEGER,
    joining_date: DataTypes.DATE,
    legal_entity_id: DataTypes.INTEGER,
    sub_entity_id: DataTypes.INTEGER,
    corporation_id: DataTypes.INTEGER,
  },
  {
    schema: "employee",
    tableName: "employee",
    timestamps: true,
  }
);

const PFOnboarding = sequelize.define(
  "PF",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    candidate_id: DataTypes.INTEGER,
    esic_documents: { type: DataTypes.ARRAY(DataTypes.JSONB) }
  },
  {
    schema: "cs_in",
    tableName: "pf_master_onboarding",
    timestamps: true,
  }
);

const PFProfile = sequelize.define(
  "PFProfile",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    candidate_id: DataTypes.INTEGER,
    esic_documents: { type: DataTypes.ARRAY(DataTypes.JSONB) }
  },
  {
    schema: "cs_in",
    tableName: "pf_master_profile",
    timestamps: true,
  }
);


const EmailLogs = sequelize.define(
  "EmailLogs",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sent_at: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    email_template: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true,
    }
  },
  {
    tableName: "email_logs",
    schema: "audit",
    timestamps: true,
  }
);

const CorporationMaster = sequelize.define(
  "CorporationMaster",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    full_name: {
      type: DataTypes.STRING,
    }, 
    short_name: {
      type: DataTypes.STRING
    },
    description: {
      type: DataTypes.STRING
    },
    established_on: {
      type: DataTypes.DATE,
    },
    status: {
      type: DataTypes.BOOLEAN,
    },
    email_id: {
      type: DataTypes.STRING,
    },
    type_of_business: {
      type: DataTypes.STRING,
    },
    is_save_as_draft: {
      type: DataTypes.BOOLEAN,
    },
    is_complete: {
      type: DataTypes.BOOLEAN,
    },
    url: {
      type: DataTypes.STRING,
    },
    address: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
    },
    created_by: {
      type: DataTypes.INTEGER,
    },
    modified_by: {
      type: DataTypes.INTEGER,
    },
    deleted_by: {
      type: DataTypes.INTEGER,
    },
    deleted_at: {
      type: DataTypes.DATE,
    },
    workspace_url: {
      type: DataTypes.STRING,
    },
    employee_size: {
      type: DataTypes.STRING,
    },
    opportunity_size: {
      type: DataTypes.INTEGER,
    },
    logo_url: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
    },
    enable_hrms_core: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    enable_sp_offroll: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    enable_sp_po: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    enable_sp_perm: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    enable_vms: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    enable_msp: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    }
  },
  {
    tableName: "corporation_master",
    schema: "ws_global",
    timestamps: true,
  }
);

const LegalEntityMaster = sequelize.define(
  "LegalEntityMaster",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    corporation_id: {
      type: DataTypes.INTEGER,
      references: {
        model: CorporationMaster,
        key: "id",
      },
    },
    name: DataTypes.STRING,
    short_name: DataTypes.STRING,
    cin: DataTypes.STRING,
    logo_url: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
    },
    email_address: DataTypes.STRING,
  
    date_of_incorporation: DataTypes.DATE,
    registered_address: DataTypes.STRING,
    corporate_address: DataTypes.STRING,
    address: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
    },
    pan: DataTypes.STRING,
    gstin: DataTypes.STRING,
    tan: DataTypes.STRING,
    act_applicable: DataTypes.STRING,
    basic_capture: DataTypes.BOOLEAN,
    enhanced_capture: DataTypes.BOOLEAN,
    status: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    modified_by: DataTypes.INTEGER,
    is_save_as_draft: DataTypes.BOOLEAN,
    is_complete: DataTypes.BOOLEAN,
    deleted_by: DataTypes.INTEGER,
    deleted_at: DataTypes.DATE,
  },
  {
    tableName: "legal_entity_master",
    schema: "global",
  }
);

const TaskMasterOnboarding = sequelize.define(
  "Task_Master_Onboarding",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    group: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    due_date: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    screen_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    corporation_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    task_for: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    approval_required: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    form_linked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    form_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    attachment_required: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    is_system_defined: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    document_url: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    tableName: "task_master_onboarding",
    schema: "main",
    timestamps: false,
  }
);

const EmployeeTasksOnboarding = sequelize.define(
  "Employee_Tasks_Onboarding",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    task_id: {
      type: DataTypes.INTEGER,
      references: {
        model: TaskMasterOnboarding,
        key: "id",
      },
    },
    due_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completion_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancel_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_over_due: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_complete: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_due: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    assigned_to: {
      type: DataTypes.INTEGER,
    },
    approval_status: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    extra: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
      allowNull: true,
    },
  },
  {
    tableName: "employee_task_config",
    schema: "employee",
    timestamps: true,
  }
);

const TaskEntitiesConfig = sequelize.define(
  "Task_Entities_Config",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    task_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Task_Master_Onboarding",
        key: "id",
      },
    },
    legal_entity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sub_entity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    all_entities: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: "task_entities_config",
    schema: "main",
    timestamps: true,
  }
);

const LeaveAccrual = sequelize.define(
  "Leave_Accrual",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    corporation_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    legal_entity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    sub_entity_id: {
      type: DataTypes.INTEGER
    },
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    leave_plan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    leave_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    month: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    leave_accrued_count: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    total_accrued_count: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    accrual_type: {
      type: DataTypes.ENUM("monthly", "yearly", "quarterly", "half_yearly"),
      allowNull: false,
    },
    limit: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    leave_type_start_from: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: "leave_accrual",
    schema: "leave_management",
    timestamps: true,
  }
);

const EmployeeExitDetails = sequelize.define(
  'Employee_Exit_Details',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    mode_of_exit: {
      type: DataTypes.STRING,
    },

    advance_notice_provided: {
      type: DataTypes.BOOLEAN,
    },

    custom_exit_date: {
      type: DataTypes.DATE,
    },

    employee_id: {
      type: DataTypes.INTEGER,
    },

    exit_id: {
      type: DataTypes.INTEGER,
    },

    exit_reason_id: {
      type: DataTypes.INTEGER,
    },

    last_working_date: {
      type: DataTypes.DATE,
    },

    preferred_last_working_date: {
      type: DataTypes.DATE,
    },

    attachment: {
      type: DataTypes.ARRAY(DataTypes.JSONB),
      allowNull: true,
    },

    comment: {
      type: DataTypes.STRING,
    },

    is_blacklisted: {
      type: DataTypes.BOOLEAN,
    },

    blacklist_comment: {
      type: DataTypes.STRING,
    },

    status: {
     type: DataTypes.STRING,
    },

    exit_group_id: {
      type: DataTypes.INTEGER,
    },

    notice_by_policy_last_working_date: {
      type: DataTypes.DATE,
    },

    is_approver_changed_last_working_date: {
      type: DataTypes.BOOLEAN,
    },

    action_by: {
      type: DataTypes.INTEGER,
    },

    action_by_type: {
      type: DataTypes.STRING,
    },

    bulk_history_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Reference to bulk operation that created this exit request',
    },

    exit_initiated_date: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when the exit process was initiated',
    },

    // withdrawal_reason: {
    //   type: DataTypes.STRING,
    // },

    // withdraw_date: {
    //   type: DataTypes.DATE,
    //   allowNull: true,
    //   comment: 'Date when the withdrawal process was initiated',
    // },

    // withdraw_by: {
    //   type: DataTypes.INTEGER,
    // },

    // withdraw_by_type: {
    //   type: DataTypes.STRING,
    // },
  },
  {
    tableName: 'employee_exit_details',
    schema: 'exit_management',
    timestamps: true,
  }
);


module.exports = { sequelize, User,Employee ,PFOnboarding,PFProfile,EmployeeTasksOnboarding,EmailLogs,LegalEntityMaster,TaskEntitiesConfig,TaskMasterOnboarding ,LeaveAccrual,EmployeeExitDetails};
